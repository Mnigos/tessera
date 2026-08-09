import { Injectable } from '@nestjs/common'
import type { RepositoryId } from '@repo/domain'
import { Queue } from 'bullmq'

export const MERGE_QUEUE_NAME = 'merge-queue'
export const MERGE_QUEUE_WAKEUP_JOB = 'merge-queue.wakeup'
export const MERGE_QUEUE_RECONCILER_JOB = 'merge-queue.reconciler'
export const MERGE_QUEUE_RECONCILER_SCHEDULER_ID =
	'merge-queue-reconciler-scheduler'
const MERGE_QUEUE_JOB_ATTEMPTS = 5
const MERGE_QUEUE_JOB_BACKOFF_DELAY_MS = 5000

export interface MergeQueueWakeup {
	repositoryId: RepositoryId
	requestedVersion: number
}

interface MergeQueueReconcilerJobData {
	type: 'reconciler'
}

export type MergeQueueJobData = MergeQueueWakeup | MergeQueueReconcilerJobData

export class MergeQueueJobQueue extends Queue<MergeQueueJobData> {}

/**
 * Wakes the merge queue worker. Redis carries no queue state: PostgreSQL knows
 * which entries exist and in what order, and a job here only says "this
 * repository has something to do". A wakeup that Redis loses costs a delay
 * rather than a merge, because the reconciler re-derives the same job from the
 * committed rows.
 */
@Injectable()
export class MergeQueue {
	constructor(private readonly queue: MergeQueueJobQueue) {}

	/**
	 * The job is keyed by the version the repository's queue state was at, so
	 * every waker of the same committed change collapses onto one job while a
	 * later change always gets its own.
	 *
	 * The two parts are joined with a hyphen rather than a colon because BullMQ
	 * reserves the colon for its own key namespacing and rejects a custom job id
	 * containing one. The repository id is a fixed-length UUID, so a hyphen
	 * cannot make two different pairs collide.
	 */
	async enqueueWakeup({
		repositoryId,
		requestedVersion,
	}: MergeQueueWakeup): Promise<void> {
		await this.queue.add(
			MERGE_QUEUE_WAKEUP_JOB,
			{ repositoryId, requestedVersion },
			{
				attempts: MERGE_QUEUE_JOB_ATTEMPTS,
				backoff: {
					type: 'exponential',
					delay: MERGE_QUEUE_JOB_BACKOFF_DELAY_MS,
				},
				jobId: `${repositoryId}-${requestedVersion}`,
				removeOnComplete: true,
				removeOnFail: true,
			}
		)
	}

	async scheduleReconciler(crontime: string): Promise<void> {
		await this.queue.upsertJobScheduler(
			MERGE_QUEUE_RECONCILER_SCHEDULER_ID,
			{ pattern: crontime },
			{
				name: MERGE_QUEUE_RECONCILER_JOB,
				data: { type: 'reconciler' },
			}
		)
	}

	async getReconcilerSchedule(): Promise<{ next?: number } | undefined> {
		return await this.queue.getJobScheduler(MERGE_QUEUE_RECONCILER_SCHEDULER_ID)
	}
}
