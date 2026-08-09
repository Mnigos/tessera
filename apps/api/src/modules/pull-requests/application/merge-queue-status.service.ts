import { Injectable } from '@nestjs/common'
import type { MergeQueueEntry, MergeQueueStatus } from '@repo/contracts'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { toMergeQueueBlockingReasons } from '../helpers/merge-queue-blocking-reasons'
import {
	type MergeQueueEntryReadModel,
	MergeQueueRepository,
} from '../infrastructure/merge-queue.repository'

interface MergeQueueTargetParams {
	pullRequestId: PullRequestId
	repositoryId: RepositoryId
}

/**
 * Where a pull request stands in its repository's merge queue.
 *
 * PostgreSQL is the queue, so reporting a place needs nothing but the committed
 * rows. Keeping that read apart from the service that mutates the queue is what
 * lets the pull request detail view report a position without the module it
 * lives in having to boot a Redis worker to do it.
 */
@Injectable()
export class MergeQueueStatusService {
	constructor(private readonly mergeQueueRepository: MergeQueueRepository) {}

	/**
	 * The stored position is an allocation order that is never renumbered, so the
	 * place shown is how many runnable entries currently sit ahead of it; a paused
	 * entry has no place at all, because nothing is waiting behind it.
	 */
	async getStatus({
		pullRequestId,
		repositoryId,
	}: MergeQueueTargetParams): Promise<MergeQueueStatus> {
		const [entry, runnableCount] = await Promise.all([
			this.mergeQueueRepository.findActiveEntry({ pullRequestId }),
			this.mergeQueueRepository.countRunnableEntries({ repositoryId }),
		])

		if (!entry) return { runnableCount }

		return {
			entry: await this.toEntryOutput(entry, repositoryId),
			runnableCount,
		}
	}

	private async toEntryOutput(
		entry: MergeQueueEntryReadModel,
		repositoryId: RepositoryId
	): Promise<MergeQueueEntry> {
		const aheadCount =
			entry.state === 'paused'
				? undefined
				: await this.mergeQueueRepository.countRunnableEntries({
						repositoryId,
						beforePosition: entry.position,
					})

		return {
			entryId: entry.id,
			state: entry.state,
			position: aheadCount === undefined ? undefined : aheadCount + 1,
			blockingReasons: toMergeQueueBlockingReasons(entry.blockingReasons),
			enqueuedAt: entry.enqueuedAt,
			stateChangedAt: entry.stateChangedAt,
		}
	}
}
