import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Injectable, Logger } from '@nestjs/common'
import type {
	MergeQueueStatus,
	MergeStrategySelection,
	ParsedGetPullRequestInput,
	ParsedJoinMergeQueueInput,
} from '@repo/contracts'
import {
	hasRepositoryRole,
	type PullRequestId,
	type RepositoryId,
	type UserId,
} from '@repo/domain'
import {
	MergeQueueEntryAlreadyExistsError,
	MergeQueueEntryForbiddenError,
	MergeQueueEntryMergingError,
	MergeQueueEntryNotFoundError,
	MergeQueueEntryNotPausedError,
} from '../domain/merge-queue.errors'
import {
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { toPullRequestMergeRequest } from '../helpers/pull-request-merge-request'
import { MergeQueue } from '../infrastructure/merge-queue.queue'
import {
	type MergeQueueMutationResult,
	MergeQueueRepository,
} from '../infrastructure/merge-queue.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { MergeQueueStatusService } from './merge-queue-status.service'

/**
 * Joining, leaving and retrying a place in a repository's merge queue.
 *
 * Everything here commits to PostgreSQL first and wakes the worker afterwards.
 * A wakeup that never reaches Redis costs a delay and nothing else, because the
 * reconciler re-derives it from the same rows; a queue change that is only in
 * Redis would be a merge nobody can account for.
 */
@Injectable()
export class MergeQueueService {
	private readonly logger = new Logger(MergeQueueService.name)

	constructor(
		private readonly mergeQueueRepository: MergeQueueRepository,
		private readonly mergeQueueStatusService: MergeQueueStatusService,
		private readonly mergeQueue: MergeQueue,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {}

	/**
	 * Puts a pull request in its repository's merge queue.
	 *
	 * The refs it is recorded against are resolved here rather than taken from the
	 * caller: the entry is a statement about what was queued, and the worker
	 * re-resolves everything anyway before it merges.
	 */
	async join(
		userId: UserId,
		input: ParsedJoinMergeQueueInput
	): Promise<MergeQueueStatus> {
		const { number, slug, username } = input
		const { repositoryId, storagePath } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findOpenPullRequest(repositoryId, number)
		const mergeability =
			await this.gitStorageClient.checkRepositoryMergeability({
				repositoryId,
				storagePath,
				baseRef: pullRequest.targetBranch,
				headRef: pullRequest.sourceBranch,
			})
		// The chosen method is recorded whether or not it is available right now:
		// the queue re-evaluates before it runs, and a method that the target
		// branch moving has since made possible should not have been discarded at
		// the door.
		//
		// The message is settled here too, not when the entry eventually runs.
		// Deriving it later would read the pull request as it is then, so editing
		// the title after queueing would silently change the commit the queue
		// writes — and the whole point of locking the method at the door is that
		// what was queued is what happens.
		const result = await this.mergeQueueRepository.enqueueEntry({
			repositoryId,
			pullRequestId: pullRequest.id,
			enqueuedByUserId: userId,
			enqueuedBaseSha: mergeability.baseSha,
			enqueuedHeadSha: mergeability.headSha,
			selection: toEnqueuedStrategySelection(pullRequest, input),
		})

		// The pull request was open when this join started and is not any more, so
		// it closed while the refs were being resolved. The enqueue held its row and
		// wrote nothing, and the caller is told what a caller who arrived a moment
		// later would have been told.
		if (result.status === 'pull_request_unavailable') {
			const current = await this.findPullRequest(repositoryId, number)

			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: current.state,
				action: 'merge queue',
			})
		}

		if (result.status === 'already_queued')
			throw new MergeQueueEntryAlreadyExistsError({
				repositoryId,
				pullRequestId: pullRequest.id,
			})

		return await this.wakeAndReport(repositoryId, result)
	}

	/**
	 * Takes a pull request back out. Whoever queued it may, and so may an
	 * administrator: a queue that only its author can unblock is one a mistake can
	 * hold hostage.
	 */
	async leave(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<MergeQueueStatus> {
		const { repositoryId, viewerRole } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const entry = await this.mergeQueueRepository.findActiveEntry({
			pullRequestId: pullRequest.id,
		})

		if (!entry)
			throw new MergeQueueEntryNotFoundError({
				repositoryId,
				pullRequestId: pullRequest.id,
			})

		const isAdministrator = hasRepositoryRole(viewerRole, 'admin')

		if (entry.enqueuedByUserId !== userId && !isAdministrator)
			throw new MergeQueueEntryForbiddenError({
				repositoryId,
				pullRequestId: pullRequest.id,
			})

		if (entry.state === 'merging')
			throw new MergeQueueEntryMergingError({
				repositoryId,
				pullRequestId: pullRequest.id,
			})

		const result = await this.mergeQueueRepository.removeEntry({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			reason:
				isAdministrator && entry.enqueuedByUserId !== userId ? 'admin' : 'user',
		})

		// The removal refused what the check above already refused, only later: the
		// entry started merging between reading it and removing it. Reading the
		// state again is what tells that race apart from an entry somebody else
		// took out in the same moment.
		if (!result) throw await this.toRemovalFailure(repositoryId, pullRequest.id)

		return await this.wakeAndReport(repositoryId, result)
	}

	/**
	 * Sends a paused entry back to the queue, at the tail. What paused it is not
	 * re-checked here — the worker is the only thing that decides whether an entry
	 * may merge, and this only asks it to look again.
	 */
	async retry(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<MergeQueueStatus> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findOpenPullRequest(repositoryId, number)
		const result = await this.mergeQueueRepository.resumeEntry({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
		})

		if (!result)
			throw new MergeQueueEntryNotPausedError({
				repositoryId,
				pullRequestId: pullRequest.id,
			})

		return await this.wakeAndReport(repositoryId, result)
	}

	/**
	 * Re-derives the queue's work from the committed rows.
	 *
	 * Two things are repaired here. Entries whose pull request stopped being open
	 * behind the queue's back — a mirror synchronization is the only path that
	 * does that — are terminalized, because nothing else will ever pick them up.
	 * And repositories with work and nothing running it are woken, which is what
	 * makes a lost Redis delivery a delay rather than a stalled queue.
	 */
	async reconcile(limit: number): Promise<void> {
		const staleEntries =
			await this.mergeQueueRepository.listEntriesForInactivePullRequests({
				limit,
			})

		for (const stale of staleEntries) {
			const result = await this.mergeQueueRepository.removeEntry({
				repositoryId: stale.repositoryId,
				pullRequestId: stale.pullRequestId,
				reason: stale.pullRequestState,
			})

			if (result)
				this.logger.log(
					`Removed merge queue entry ${result.entry.id} because its pull request is ${stale.pullRequestState}`
				)
		}

		const wakeups = await this.mergeQueueRepository.listWakeups({
			limit,
			now: new Date(),
		})

		await Promise.all(
			wakeups.map(wakeup => this.mergeQueue.enqueueWakeup(wakeup))
		)
	}

	private async toRemovalFailure(
		repositoryId: RepositoryId,
		pullRequestId: PullRequestId
	): Promise<Error> {
		const entry = await this.mergeQueueRepository.findActiveEntry({
			pullRequestId,
		})

		if (entry?.state === 'merging')
			return new MergeQueueEntryMergingError({ repositoryId, pullRequestId })

		return new MergeQueueEntryNotFoundError({ repositoryId, pullRequestId })
	}

	private async wakeAndReport(
		repositoryId: RepositoryId,
		{ entry, requestedVersion }: MergeQueueMutationResult
	): Promise<MergeQueueStatus> {
		await this.enqueueWakeup(repositoryId, requestedVersion)

		return await this.mergeQueueStatusService.getStatus({
			pullRequestId: entry.pullRequestId,
			repositoryId,
		})
	}

	/**
	 * The change is already committed by the time this runs, so a Redis that will
	 * not take the job is worth a line in the log and nothing more: the reconciler
	 * finds the same work on its next pass, and failing the caller's request would
	 * report a queue change that did happen as one that did not.
	 */
	private async enqueueWakeup(
		repositoryId: RepositoryId,
		requestedVersion: number
	): Promise<void> {
		try {
			await this.mergeQueue.enqueueWakeup({ repositoryId, requestedVersion })
		} catch (error) {
			this.logger.warn(
				`Failed to wake the merge queue for repository ${repositoryId}; the reconciler will pick it up: ${String(error)}`
			)
		}
	}

	private async findOpenPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestReadModel> {
		const pullRequest = await this.findPullRequest(repositoryId, number)

		if (pullRequest.state !== 'open')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'merge queue',
			})

		return pullRequest
	}

	private async findPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestReadModel> {
		const pullRequest = await this.pullRequestsRepository.find({
			repositoryId,
			number,
		})

		if (!pullRequest)
			throw new PullRequestNotFoundError({ repositoryId, number })

		return pullRequest
	}
}

/**
 * The method and, for a squash, the exact message the entry will merge with.
 *
 * The defaults are derived once, here, from the pull request as it stands at the
 * moment of queueing. Everything the queue later executes comes off the row.
 */
function toEnqueuedStrategySelection(
	pullRequest: PullRequestReadModel,
	selection: MergeStrategySelection
): MergeStrategySelection {
	if (selection.strategy !== 'squash') return selection

	const request = toPullRequestMergeRequest({
		evaluatedBaseSha: pullRequest.openingBaseSha,
		evaluatedHeadSha: pullRequest.openingHeadSha,
		pullRequest,
		selection,
	})

	return {
		strategy: 'squash',
		squashTitle: request.squashTitle,
		squashBody: request.squashBody,
	}
}
