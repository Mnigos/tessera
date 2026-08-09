import { randomUUID } from 'node:crypto'
import { GitStorageClient } from '@config/git-storage'
import { Injectable } from '@nestjs/common'
import type {
	PullRequest as PullRequestEntity,
	PullRequestMergeBypass,
} from '@repo/db'
import type {
	MergeQueueEntryId,
	MergeStrategy,
	MergeStrategyUnavailableReason,
	RepositoryId,
	UserId,
} from '@repo/domain'
import {
	PullRequestMergeConflictError,
	PullRequestMergeStrategyUnavailableError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import type { PullRequestMergeRequest } from '../helpers/pull-request-merge-request'
import { toPullRequestStorageError } from '../helpers/pull-request-storage-error'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'

/**
 * How long a merge intent stands before another attempt may assume the one that
 * wrote it died. It has to outlive the git storage round trip it covers, or a
 * concurrent close can delete the intent of a merge that is still in flight and
 * leave the target moved with nothing recording it. See `MERGE_RPC_TIMEOUT_MS`,
 * which this is asserted against.
 */
export const MERGE_INTENT_LEASE_MS = 60_000
/**
 * How long one merge may hold a repository before another may assume it died.
 * Comfortably longer than the Git merge round trip, and short enough that a
 * crashed process does not park the repository for an operator to notice.
 */
export const REPOSITORY_MERGE_LEASE_MS = 120_000

export interface PullRequestMergeActor {
	email: string
	id: UserId
	name: string
}

export interface RunPullRequestMergeParams {
	actor: PullRequestMergeActor
	/** Present only when the attempt is deliberately merging past policy. */
	bypass?: PullRequestMergeBypass
	leaseOwner: string
	pullRequest: PullRequestReadModel
	/** Present when a queue run is merging, so its entry finishes with the merge. */
	queueEntryId?: MergeQueueEntryId
	repositoryId: RepositoryId
	/** Exactly what Git is to be asked for, resolved by the caller's evaluation. */
	request: PullRequestMergeRequest
	storagePath: string
}

/**
 * What became of a merge that was already cleared to happen.
 *
 * `refs_moved` carries the error the direct endpoint has always raised alongside
 * what Git objected to, because the same rejection means "try again" to a caller
 * who is watching and "wait here" to a queue entry that is not.
 */
export type PullRequestMergeAttempt =
	| { outcome: 'merged'; pullRequest: PullRequestEntity }
	| { outcome: 'lease_lost' }
	| {
			outcome: 'refs_moved'
			error: unknown
			kind: PullRequestMergeRefusal
	  }
	| { outcome: 'state_conflict'; state: PullRequestEntity['state'] }

/**
 * Why Git refused a merge it was asked to make. All three describe the world
 * rather than the request, so all three are worth attempting again once it
 * changes — and all three are reported back as blocking reasons rather than
 * failures.
 */
export type PullRequestMergeRefusal =
	| { code: 'merge_conflict' }
	| { code: 'stale_refs' }
	| {
			code: 'merge_strategy_unavailable'
			strategy: MergeStrategy
			reason: MergeStrategyUnavailableReason
	  }

/**
 * The part of merging that both merge paths share: claim the pull request's
 * merge intent, prove the repository lease is still held, ask Git to
 * compare-and-swap the target ref, and record the outcome.
 *
 * Deciding *whether* to merge belongs to the callers — the endpoint answers a
 * person and the worker answers a queue entry, and they refuse in different
 * ways. By the time execution reaches here the decision is made and the SHAs are
 * the ones the evaluation resolved.
 */
@Injectable()
export class PullRequestMergeRunner {
	constructor(
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly mergeQueueRepository: MergeQueueRepository,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async run({
		actor,
		bypass,
		leaseOwner,
		pullRequest,
		queueEntryId,
		repositoryId,
		request,
		storagePath,
	}: RunPullRequestMergeParams): Promise<PullRequestMergeAttempt> {
		const attemptId = randomUUID()
		const startedAt = new Date()
		const claimed = await this.pullRequestsRepository.claimMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			bypass,
			request,
			startedAt,
			staleBefore: new Date(startedAt.getTime() - MERGE_INTENT_LEASE_MS),
		})

		if (!claimed) {
			const currentPullRequest = await this.pullRequestsRepository.findById({
				pullRequestId: pullRequest.id,
			})

			if (currentPullRequest?.state === 'merged')
				return { outcome: 'merged', pullRequest: currentPullRequest }

			return {
				outcome: 'state_conflict',
				state: currentPullRequest?.state ?? pullRequest.state,
			}
		}

		// Evaluating the requirements can take longer than the lease has left —
		// branch protection, checks and a mergeability round trip all happen under
		// it. Git is asked to move refs only while this attempt still demonstrably
		// holds the repository, so a lease that aged out and was taken by somebody
		// else stops the merge here rather than racing theirs.
		const leaseHeld = await this.mergeQueueRepository.renewRepositoryMergeLease(
			{
				repositoryId,
				owner: leaseOwner,
				ttlMs: REPOSITORY_MERGE_LEASE_MS,
			}
		)

		if (!leaseHeld) {
			await this.pullRequestsRepository.releaseMerge({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: actor.id,
				attemptId,
			})

			return { outcome: 'lease_lost' }
		}

		const mergeResult = await this.mergeRepositoryRefs({
			actor,
			attemptId,
			pullRequest,
			repositoryId,
			request: claimed.request,
			storagePath,
		})

		if ('kind' in mergeResult) return { outcome: 'refs_moved', ...mergeResult }

		const mergedPullRequest = await this.pullRequestsRepository.completeMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			changedAt: new Date(),
			resultingSha: mergeResult.resultingSha,
			queueEntryId,
		})

		if (mergedPullRequest)
			return { outcome: 'merged', pullRequest: mergedPullRequest }

		// Git has merged and the completion did not apply, which is either somebody
		// else's completion of the same merge or a pull request that moved on
		// underneath this attempt. The row decides which.
		const currentPullRequest = await this.pullRequestsRepository.findById({
			pullRequestId: pullRequest.id,
		})

		if (currentPullRequest?.state === 'merged')
			return { outcome: 'merged', pullRequest: currentPullRequest }

		return { outcome: 'state_conflict', state: pullRequest.state }
	}

	private async mergeRepositoryRefs({
		actor,
		attemptId,
		pullRequest,
		repositoryId,
		request,
		storagePath,
	}: {
		actor: PullRequestMergeActor
		attemptId: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		request: PullRequestMergeRequest
		storagePath: string
	}): Promise<
		{ resultingSha: string } | { error: unknown; kind: PullRequestMergeRefusal }
	> {
		try {
			return {
				resultingSha: await this.gitStorageClient.mergeRepositoryRefs({
					repositoryId,
					storagePath,
					baseRef: pullRequest.targetBranch,
					headRef: pullRequest.sourceBranch,
					expectedBaseSha: request.expectedBaseSha,
					expectedHeadSha: request.expectedHeadSha,
					authorName: actor.name,
					authorEmail: actor.email,
					message: request.commitMessage ?? '',
					squashTitle: request.squashTitle,
					squashBody: request.squashBody,
					strategy: request.strategy,
					// Stable across every attempt, which is what lets git storage
					// recognise a merge it has already made under this identifier.
					operationId: pullRequest.id,
				}),
			}
		} catch (error) {
			const storageError = toPullRequestStorageError(
				error,
				{ repositoryId, number: pullRequest.number },
				request.strategy
			)
			const kind = toRefusal(storageError)

			if (!kind) throw storageError

			// Git had the last word on freshness and conflicts, and it disagreed with
			// the evaluation this attempt was cleared by. The intent is handed back so
			// the next attempt — this caller's retry or the next queue run — is not
			// locked out by an attempt that will never finish.
			await this.pullRequestsRepository.releaseMerge({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: actor.id,
				attemptId,
			})

			return { error: storageError, kind }
		}
	}
}

/**
 * Whether Git refused because the world moved rather than because the request
 * was wrong. Only these rejections leave a merge worth attempting again.
 */
function toRefusal(error: unknown): PullRequestMergeRefusal | undefined {
	if (error instanceof PullRequestMergeConflictError)
		return { code: 'merge_conflict' }
	if (error instanceof PullRequestStaleComparisonError)
		return { code: 'stale_refs' }
	if (error instanceof PullRequestMergeStrategyUnavailableError)
		return {
			code: 'merge_strategy_unavailable',
			strategy: error.strategy,
			reason: error.unavailableReason,
		}

	return undefined
}
