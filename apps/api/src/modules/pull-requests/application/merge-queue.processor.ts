import { randomUUID } from 'node:crypto'
import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import {
	RepositoriesService,
	type RepositoryMergeContext,
} from '@modules/repositories'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type {
	MergeBlockingReason,
	MergeRequirements,
	MergeStrategySelection,
} from '@repo/contracts'
import type { RepositoryId } from '@repo/domain'
import type { Job } from 'bullmq'
import { toMergeQueuePauseReasons } from '../helpers/merge-queue-blocking-reasons'
import { toPullRequestMergeRequest } from '../helpers/pull-request-merge-request'
import {
	MERGE_QUEUE_NAME,
	MERGE_QUEUE_RECONCILER_JOB,
	MergeQueue,
	type MergeQueueJobData,
	type MergeQueueWakeup,
} from '../infrastructure/merge-queue.queue'
import {
	MergeQueueRepository,
	type MergeQueueRunnableEntry,
} from '../infrastructure/merge-queue.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { MergeQueueService } from './merge-queue.service'
import { MergeRequirementsService } from './merge-requirements.service'
import {
	MERGE_INTENT_LEASE_MS,
	type PullRequestMergeRefusal,
	PullRequestMergeRunner,
	REPOSITORY_MERGE_LEASE_MS,
} from './pull-request-merge.runner'

/**
 * One repository merges at a time whatever this is set to — the repository
 * lease sees to that — so this only decides how many repositories may merge at
 * once on one instance.
 */
const MERGE_QUEUE_CONCURRENCY = 4

/** Whether the run may go on to the entry behind this one. */
type MergeQueueRunStep = 'continue' | 'stop'

/**
 * Runs one repository's merge queue.
 *
 * A job carries nothing but a repository and the version its queue was at:
 * PostgreSQL says which entries exist, in what order, and what they are waiting
 * for. That is what makes a duplicate delivery harmless — the second one finds
 * the work already done and the state transitions it would make already made.
 *
 * Each entry is evaluated in full, immediately before it merges, and each merge
 * moves the target branch out from under the entries behind it. So the next
 * entry is evaluated again rather than trusted: what was mergeable one merge ago
 * is not a claim about now.
 */
@Injectable()
@Processor(MERGE_QUEUE_NAME, { concurrency: MERGE_QUEUE_CONCURRENCY })
export class MergeQueueProcessor extends WorkerHost {
	private readonly logger = new Logger(MergeQueueProcessor.name)

	constructor(
		private readonly envService: EnvService,
		private readonly gitStorageClient: GitStorageClient,
		private readonly mergeQueue: MergeQueue,
		private readonly mergeQueueRepository: MergeQueueRepository,
		private readonly mergeQueueService: MergeQueueService,
		private readonly mergeRequirementsService: MergeRequirementsService,
		private readonly pullRequestMergeRunner: PullRequestMergeRunner,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService
	) {
		super()
	}

	async process(job: Job<MergeQueueJobData>): Promise<void> {
		if (job.name === MERGE_QUEUE_RECONCILER_JOB) {
			await this.mergeQueueService.reconcile(
				this.envService.get('MERGE_QUEUE_RECONCILER_BATCH_SIZE')
			)

			return
		}

		if (!isMergeQueueWakeup(job.data)) return

		await this.runRepository(job.data)
	}

	private async runRepository({
		repositoryId,
		requestedVersion,
	}: MergeQueueWakeup): Promise<void> {
		const leaseOwner = randomUUID()
		const leaseAcquired =
			await this.mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId,
				owner: leaseOwner,
				ttlMs: REPOSITORY_MERGE_LEASE_MS,
			})

		// Somebody is already merging this repository — another run, or a direct
		// merge. Whoever holds it will drain what it can, and whatever is left over
		// is still committed and still wakeable.
		if (!leaseAcquired) return

		try {
			// Only the lease holder moves entries through `validating` and `merging`,
			// so any this run finds on arrival were left by a process that died
			// holding the lease this one just took over.
			const orphaned = await this.mergeQueueRepository.resetOrphanedEntries({
				repositoryId,
			})

			if (orphaned > 0)
				this.logger.warn(
					`Returned ${orphaned} abandoned merge queue ${orphaned === 1 ? 'entry' : 'entries'} of repository ${repositoryId} to the queue`
				)

			await this.drain(repositoryId, leaseOwner)
		} finally {
			await this.mergeQueueRepository
				.releaseRepositoryMergeLease({ repositoryId, owner: leaseOwner })
				.catch((error: unknown) =>
					this.logger.warn(
						`Failed to release the merge lease on repository ${repositoryId}; it expires in ${REPOSITORY_MERGE_LEASE_MS}ms: ${String(error)}`
					)
				)
		}

		const followUpVersion = await this.mergeQueueRepository.completeWakeup({
			repositoryId,
			requestedVersion,
		})

		// The queue changed while this run was serving it. Chaining the follow-up
		// here rather than leaving it to the reconciler is what keeps a queue that
		// is being added to from waiting a whole cron interval between merges.
		if (followUpVersion)
			await this.mergeQueue.enqueueWakeup({
				repositoryId,
				requestedVersion: followUpVersion,
			})
	}

	private async drain(
		repositoryId: RepositoryId,
		leaseOwner: string
	): Promise<void> {
		let step: MergeQueueRunStep = 'continue'

		while (step === 'continue') {
			const entry = await this.mergeQueueRepository.findNextRunnableEntry({
				repositoryId,
			})

			if (!entry) return

			step = await this.runEntry({ entry, leaseOwner, repositoryId })
		}
	}

	/**
	 * Takes one entry as far as it can go: to a merge, to a pause with the reasons
	 * that stopped it, or out of the queue entirely when the pull request it was
	 * waiting for is no longer open.
	 */
	private async runEntry({
		entry,
		leaseOwner,
		repositoryId,
	}: {
		entry: MergeQueueRunnableEntry
		leaseOwner: string
		repositoryId: RepositoryId
	}): Promise<MergeQueueRunStep> {
		const context = await this.repositoriesService.findRepositoryMergeContext({
			repositoryId,
			userId: entry.enqueuedBy.id,
		})

		// A repository with no storage cannot be merged into and cannot be
		// explained to the entry either, so the run stops rather than parking every
		// entry behind a reason nobody can act on.
		if (!context) {
			this.logger.error(
				`Merge queue cannot resolve repository ${repositoryId}, so its queue is left untouched`
			)

			return 'stop'
		}

		const pullRequest = await this.pullRequestsRepository.findById({
			pullRequestId: entry.pullRequestId,
		})

		if (!pullRequest) {
			this.logger.error(
				`Merge queue entry ${entry.id} points at a pull request that no longer exists`
			)

			return 'stop'
		}

		if (pullRequest.state !== 'open') {
			await this.removeEntry(repositoryId, pullRequest)

			return 'continue'
		}

		if (
			!(await this.mergeQueueRepository.startValidatingEntry({
				entryId: entry.id,
				leaseOwner,
			}))
		)
			return 'stop'

		// An earlier run of this entry may have reached Git and died before
		// recording it, which would leave the target somewhere a fresh evaluation
		// reads as stale. Finishing that merge comes first, exactly as it does on
		// the direct path.
		if (await this.recoverAbandonedMerge({ context, pullRequest }))
			return 'continue'

		const requirements = await this.mergeRequirementsService.evaluate({
			leaseOwner,
			pullRequest,
			queueEntryId: entry.id,
			repositoryId,
			storagePath: context.storagePath,
			strategy: entry.strategy,
			tesseraWritesAllowed: context.tesseraWritesAllowed,
			viewerRole: context.viewerRole,
		})

		// The evaluation ran under this run's own lease, so this reason can only
		// mean the hold aged out while it ran. Whatever the entry is doing now is
		// the next holder's business, and this run leaves without a word: parking
		// it here would pause somebody else's entry with a verdict about a
		// repository it no longer speaks for.
		if (hasLostRepositoryLease(requirements)) return 'stop'

		if (!requirements.eligible)
			return await this.pause(entry, pullRequest, requirements, leaseOwner)

		const { evaluatedBaseSha, evaluatedHeadSha } = requirements

		if (!(evaluatedBaseSha && evaluatedHeadSha)) {
			this.logger.error(
				`Merge queue entry ${entry.id} passed evaluation without resolved refs`
			)

			return 'stop'
		}

		if (
			!(await this.mergeQueueRepository.startMergingEntry({
				entryId: entry.id,
				leaseOwner,
			}))
		)
			return 'stop'

		return await this.merge({
			context,
			entry,
			evaluatedBaseSha,
			evaluatedHeadSha,
			leaseOwner,
			pullRequest,
		})
	}

	private async merge({
		context,
		entry,
		evaluatedBaseSha,
		evaluatedHeadSha,
		leaseOwner,
		pullRequest,
	}: {
		context: RepositoryMergeContext
		entry: MergeQueueRunnableEntry
		evaluatedBaseSha: string
		evaluatedHeadSha: string
		leaseOwner: string
		pullRequest: PullRequestReadModel
	}): Promise<MergeQueueRunStep> {
		const { repositoryId } = context
		const attempt = await this.pullRequestMergeRunner.run({
			actor: {
				id: entry.enqueuedBy.id,
				email: entry.enqueuedBy.email,
				name: entry.enqueuedBy.name,
			},
			leaseOwner,
			pullRequest,
			queueEntryId: entry.id,
			repositoryId,
			request: toPullRequestMergeRequest({
				evaluatedBaseSha,
				evaluatedHeadSha,
				pullRequest,
				selection: toQueuedStrategySelection(entry),
			}),
			storagePath: context.storagePath,
		})

		switch (attempt.outcome) {
			// The target has moved. Everything still waiting is evaluated against the
			// branch this merge just created rather than the one it was queued
			// against, which is the whole point of merging through a queue.
			case 'merged':
				this.logger.log(
					`Merge queue merged pull request ${pullRequest.id} of repository ${repositoryId}`
				)

				return 'continue'
			// The lease aged out mid-merge and somebody else may hold it now. This run
			// has no standing to touch the repository any further.
			case 'lease_lost':
				return 'stop'
			// Git disagreed with an evaluation that was moments old, so the entry is
			// parked with what a fresh look says rather than with a guess.
			case 'refs_moved':
				return await this.pauseAfterRefsMoved({
					context,
					entry,
					evaluatedBaseSha,
					evaluatedHeadSha,
					leaseOwner,
					pullRequest,
					kind: attempt.kind,
				})
			default:
				return await this.pauseAfterStateConflict(
					entry,
					pullRequest,
					leaseOwner
				)
		}
	}

	/**
	 * Re-evaluates after Git rejected the merge, so the entry is paused with the
	 * refs and the conflict as they actually are now. If the fresh look reports
	 * nothing, what Git objected to is recorded from what this attempt knew.
	 */
	private async pauseAfterRefsMoved({
		context,
		entry,
		evaluatedBaseSha,
		evaluatedHeadSha,
		kind,
		leaseOwner,
		pullRequest,
	}: {
		context: RepositoryMergeContext
		entry: MergeQueueRunnableEntry
		evaluatedBaseSha: string
		evaluatedHeadSha: string
		kind: PullRequestMergeRefusal
		leaseOwner: string
		pullRequest: PullRequestReadModel
	}): Promise<MergeQueueRunStep> {
		const requirements = await this.mergeRequirementsService.evaluate({
			expected: { baseSha: evaluatedBaseSha, headSha: evaluatedHeadSha },
			leaseOwner,
			pullRequest,
			queueEntryId: entry.id,
			repositoryId: context.repositoryId,
			storagePath: context.storagePath,
			tesseraWritesAllowed: context.tesseraWritesAllowed,
			viewerRole: context.viewerRole,
		})

		return await this.pause(entry, pullRequest, requirements, leaseOwner, [
			toRefusalReason({
				kind,
				requirements,
				triedBaseSha: evaluatedBaseSha,
				triedHeadSha: evaluatedHeadSha,
			}),
		])
	}

	/**
	 * The pull request moved on between evaluating it and claiming it — it was
	 * closed, or another attempt holds its merge intent. Either way this entry is
	 * not the one to resolve it.
	 */
	private async pauseAfterStateConflict(
		entry: MergeQueueRunnableEntry,
		pullRequest: PullRequestReadModel,
		leaseOwner: string
	): Promise<MergeQueueRunStep> {
		const currentPullRequest = await this.pullRequestsRepository.findById({
			pullRequestId: pullRequest.id,
		})

		if (currentPullRequest && currentPullRequest.state !== 'open') {
			await this.removeEntry(
				currentPullRequest.repositoryId,
				currentPullRequest
			)

			return 'continue'
		}

		const paused = await this.mergeQueueRepository.pauseEntry({
			entryId: entry.id,
			leaseOwner,
			pullRequestId: pullRequest.id,
			blockingReasons: [{ code: 'repository_merge_in_progress' }],
		})

		return paused ? 'continue' : 'stop'
	}

	private async pause(
		entry: MergeQueueRunnableEntry,
		pullRequest: PullRequestReadModel,
		requirements: MergeRequirements,
		leaseOwner: string,
		fallbackReasons: MergeBlockingReason[] = []
	): Promise<MergeQueueRunStep> {
		const reasons = toMergeQueuePauseReasons(
			requirements.reasons.length > 0 ? requirements.reasons : fallbackReasons
		)

		if (reasons.length === 0) {
			// Nothing refuses this entry any more, which means the world changed
			// again while it was being judged. Parking it with no reason to give
			// would be worse than leaving it mid-flight: the next run finds it there,
			// returns it to the queue as abandoned, and judges it afresh.
			this.logger.debug(
				`Merge queue entry ${entry.id} has nothing blocking it after re-evaluation`
			)

			return 'stop'
		}

		const paused = await this.mergeQueueRepository.pauseEntry({
			entryId: entry.id,
			leaseOwner,
			pullRequestId: pullRequest.id,
			blockingReasons: reasons,
			evaluatedBaseSha: requirements.evaluatedBaseSha,
			evaluatedHeadSha: requirements.evaluatedHeadSha,
		})

		// The fence refused the write, so the entry moved on or this run's lease
		// did. Either way it has nothing further to say about this repository.
		return paused ? 'continue' : 'stop'
	}

	/**
	 * Finishes recording a merge an earlier attempt made and never wrote down, so
	 * the queue moves on rather than parking this entry behind a target that
	 * merge already moved.
	 *
	 * Like the direct path, it records rather than merges: git storage is asked
	 * only whether the operation left a receipt. An intent with none describes a
	 * merge that never happened, and is released so the entry is evaluated on its
	 * own merits instead of running unattended on somebody else's verdict.
	 *
	 * The entry is deliberately not named as the one making the merge. The
	 * abandoned attempt may have been a direct merge rather than a queue run, and
	 * claiming its work for this entry would be a lie the queue history keeps —
	 * the completion drops the entry as merged, which is what it does for every
	 * entry left on a merged pull request.
	 */
	private async recoverAbandonedMerge({
		context,
		pullRequest,
	}: {
		context: RepositoryMergeContext
		pullRequest: PullRequestReadModel
	}): Promise<boolean> {
		if (!context.tesseraWritesAllowed) return false

		const intent = await this.pullRequestsRepository.findRecoverableMergeIntent(
			{
				pullRequestId: pullRequest.id,
				staleBefore: new Date(Date.now() - MERGE_INTENT_LEASE_MS),
			}
		)

		if (!intent) return false

		const resultingSha =
			intent.request &&
			(await this.gitStorageClient.findMergeReceipt({
				repositoryId: context.repositoryId,
				storagePath: context.storagePath,
				operationId: pullRequest.id,
				strategy: intent.request.strategy,
				expectedBaseSha: intent.request.expectedBaseSha,
				expectedHeadSha: intent.request.expectedHeadSha,
			}))

		// An intent written before requests were recorded — which the strategies
		// migration deliberately left in place rather than requiring a quiesce —
		// cannot be looked up and cannot be replayed. Releasing it hands the merge
		// back to a fresh evaluation, and the bounded legacy trailer scan is what
		// still stops a pre-receipt merge_commit from being made twice.
		if (!resultingSha) {
			this.logger.log(
				`Merge queue is releasing the abandoned merge intent of pull request ${pullRequest.id}; git storage has no receipt for it`
			)
			await this.pullRequestsRepository.releaseMerge({
				repositoryId: context.repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: intent.actor.id,
				attemptId: intent.attemptId,
			})

			return false
		}

		this.logger.log(
			`Merge queue is recording the abandoned merge of pull request ${pullRequest.id}, which git storage had already made`
		)
		const merged = await this.pullRequestsRepository.completeMerge({
			repositoryId: context.repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: intent.actor.id,
			attemptId: intent.attemptId,
			changedAt: new Date(),
			resultingSha,
		})

		return Boolean(merged)
	}

	private async removeEntry(
		repositoryId: RepositoryId,
		pullRequest: PullRequestReadModel
	): Promise<void> {
		if (pullRequest.state === 'open') return

		await this.mergeQueueRepository.removeEntry({
			repositoryId,
			pullRequestId: pullRequest.id,
			reason: pullRequest.state,
		})
	}
}

function isMergeQueueWakeup(data: MergeQueueJobData): data is MergeQueueWakeup {
	return 'repositoryId' in data
}

/**
 * Whether an evaluation the worker asked for under its own lease came back
 * saying the repository is being merged. Somebody else holds it, or nobody does
 * and this run's hold aged out — both mean this run is no longer the one running
 * the repository.
 */
function hasLostRepositoryLease({ reasons }: MergeRequirements): boolean {
	return reasons.some(reason => reason.code === 'repository_merge_in_progress')
}

/**
 * The method and message the entry was queued with.
 *
 * Both come off the row and nothing is re-derived here: the message was settled
 * when the entry was created, so editing the pull request afterwards cannot
 * change the commit the queue writes. An entry queued before messages were
 * recorded carries none, and falls back to deriving one — the only thing left to
 * do for a row that never stored it.
 */
function toQueuedStrategySelection(
	entry: MergeQueueRunnableEntry
): MergeStrategySelection {
	if (entry.strategy !== 'squash') return { strategy: entry.strategy }

	return {
		strategy: 'squash',
		squashTitle: entry.squashTitle ?? undefined,
		squashBody: entry.squashBody ?? undefined,
	}
}

/**
 * What Git objected to, told as the reason the entry is parked with. A stale
 * refusal names where the branches actually are now; the other two describe the
 * attempt itself and need nothing from the re-evaluation.
 */
function toRefusalReason({
	kind,
	requirements,
	triedBaseSha,
	triedHeadSha,
}: {
	kind: PullRequestMergeRefusal
	requirements: MergeRequirements
	triedBaseSha: string
	triedHeadSha: string
}): MergeBlockingReason {
	if (kind.code === 'merge_conflict')
		return {
			code: 'merge_conflict',
			baseSha: triedBaseSha,
			headSha: triedHeadSha,
		}

	if (kind.code === 'merge_strategy_unavailable') return kind

	return {
		code: 'stale_refs',
		expectedBaseSha: triedBaseSha,
		actualBaseSha: requirements.evaluatedBaseSha ?? triedBaseSha,
		expectedHeadSha: triedHeadSha,
		actualHeadSha: requirements.evaluatedHeadSha ?? triedHeadSha,
	}
}
