import { randomUUID } from 'node:crypto'
import { GitStorageClient } from '@config/git-storage'
import { Injectable } from '@nestjs/common'
import type {
	PullRequest as PullRequestEntity,
	PullRequestMergeBypass,
} from '@repo/db'
import type { MergeQueueEntryId, RepositoryId, UserId } from '@repo/domain'
import {
	PullRequestMergeConflictError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import { toPullRequestStorageError } from '../helpers/pull-request-storage-error'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'

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
	evaluatedBaseSha: string
	evaluatedHeadSha: string
	leaseOwner: string
	pullRequest: PullRequestReadModel
	/** Present when a queue run is merging, so its entry finishes with the merge. */
	queueEntryId?: MergeQueueEntryId
	repositoryId: RepositoryId
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
			kind: 'merge_conflict' | 'stale_refs'
	  }
	| { outcome: 'state_conflict'; state: PullRequestEntity['state'] }

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
		evaluatedBaseSha,
		evaluatedHeadSha,
		leaseOwner,
		pullRequest,
		queueEntryId,
		repositoryId,
		storagePath,
	}: RunPullRequestMergeParams): Promise<PullRequestMergeAttempt> {
		const attemptId = randomUUID()
		const startedAt = new Date()
		const claimedPullRequest = await this.pullRequestsRepository.claimMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			bypass,
			startedAt,
			staleBefore: new Date(startedAt.getTime() - MERGE_INTENT_LEASE_MS),
		})

		if (!claimedPullRequest) {
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
			expectedBaseSha: evaluatedBaseSha,
			expectedHeadSha: evaluatedHeadSha,
			pullRequest,
			repositoryId,
			storagePath,
		})

		if ('kind' in mergeResult) return { outcome: 'refs_moved', ...mergeResult }

		const mergedPullRequest = await this.pullRequestsRepository.completeMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			changedAt: new Date(),
			mergeCommitSha: mergeResult.mergeCommitSha,
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
		expectedBaseSha,
		expectedHeadSha,
		pullRequest,
		repositoryId,
		storagePath,
	}: {
		actor: PullRequestMergeActor
		attemptId: string
		expectedBaseSha: string
		expectedHeadSha: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
	}): Promise<
		| { mergeCommitSha: string }
		| { error: unknown; kind: 'merge_conflict' | 'stale_refs' }
	> {
		try {
			return {
				mergeCommitSha: await this.gitStorageClient.mergeRepositoryRefs({
					repositoryId,
					storagePath,
					baseRef: pullRequest.targetBranch,
					headRef: pullRequest.sourceBranch,
					expectedBaseSha,
					expectedHeadSha,
					authorName: actor.name,
					authorEmail: actor.email,
					message: `Merge pull request #${pullRequest.number}: ${pullRequest.title}`,
					operationId: pullRequest.id,
				}),
			}
		} catch (error) {
			const storageError = toPullRequestStorageError(error, {
				repositoryId,
				number: pullRequest.number,
			})

			const kind = toRefsMovedKind(storageError)

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
 * was wrong. Only these two rejections leave a merge worth attempting again.
 */
function toRefsMovedKind(
	error: unknown
): 'merge_conflict' | 'stale_refs' | undefined {
	if (error instanceof PullRequestMergeConflictError) return 'merge_conflict'
	if (error instanceof PullRequestStaleComparisonError) return 'stale_refs'

	return undefined
}
