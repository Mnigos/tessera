import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { GitHubSyncRequest } from './github-sync.repository'

export const GITHUB_SYNC_QUEUE_NAME = 'github-sync'
export const GITHUB_SYNC_REPOSITORY_JOB = 'github-sync.repository'
export const GITHUB_SYNC_DISPATCHER_JOB = 'github-sync.dispatcher'
export const GITHUB_SYNC_SCHEDULER_ID = 'github-sync-dispatcher-scheduler'
const GITHUB_SYNC_JOB_ATTEMPTS = 5
const GITHUB_SYNC_JOB_BACKOFF_DELAY_MS = 10_000
/**
 * How many failed jobs Redis keeps for inspection. PostgreSQL holds the durable
 * attempt history, so this is a debugging convenience with a bound rather than
 * a dead-letter queue — but discarding every failure, as this queue used to,
 * left nothing at all to look at while a repository was failing.
 */
const GITHUB_SYNC_FAILED_JOB_RETENTION = 200

interface GitHubSyncDispatcherJobData {
	type: 'dispatcher'
}

export type GitHubSyncJobData = GitHubSyncRequest | GitHubSyncDispatcherJobData

export class GitHubSyncJobQueue extends Queue<GitHubSyncJobData> {}

@Injectable()
export class GitHubSyncQueue {
	constructor(private readonly queue: GitHubSyncJobQueue) {}

	/**
	 * The job is keyed by the repository, the authority it belongs to, and the
	 * version it was requested at, so every waker of the same committed change
	 * collapses onto one job while a later change always gets its own.
	 *
	 * The parts are joined with hyphens rather than colons because BullMQ reserves
	 * the colon for its own key namespacing and rejects a custom job id containing
	 * one. The repository id is a fixed-length UUID and the two counters are
	 * digits, so a hyphen cannot make two different triples collide.
	 */
	async enqueue(request: GitHubSyncRequest): Promise<void> {
		const jobId = `${request.repositoryId}-${request.authorityGeneration}-${request.requestedSyncVersion}`

		await this.discardFailedJob(jobId)
		await this.queue.add(GITHUB_SYNC_REPOSITORY_JOB, request, {
			attempts: GITHUB_SYNC_JOB_ATTEMPTS,
			backoff: {
				type: 'exponential',
				delay: GITHUB_SYNC_JOB_BACKOFF_DELAY_MS,
			},
			jobId,
			removeOnComplete: true,
			removeOnFail: { count: GITHUB_SYNC_FAILED_JOB_RETENTION },
		})
	}

	/**
	 * Clears the way for a version to be woken again.
	 *
	 * A retained failed job keeps its custom id, and BullMQ silently ignores an
	 * add whose id already exists. Retention alone would therefore turn every
	 * deferred retry into a permanent stall: PostgreSQL keeps reporting the
	 * version as outstanding, the dispatcher keeps asking for it, and the queue
	 * keeps dropping the request on the floor.
	 *
	 * Only failed jobs are removed. A version PostgreSQL has settled is never
	 * re-enqueued, so its job stays behind as the diagnostic record.
	 */
	private async discardFailedJob(jobId: string): Promise<void> {
		const job = await this.queue.getJob(jobId)

		if (!(job && (await job.isFailed()))) return

		try {
			await job.remove()
		} catch {
			// A job another worker is already retrying refuses removal, which is the
			// answer we wanted anyway: that version is on its way back.
		}
	}

	async scheduleDispatcher(crontime: string): Promise<void> {
		await this.queue.upsertJobScheduler(
			GITHUB_SYNC_SCHEDULER_ID,
			{ pattern: crontime },
			{
				name: GITHUB_SYNC_DISPATCHER_JOB,
				data: { type: 'dispatcher' },
			}
		)
	}

	async getDispatcherSchedule(): Promise<{ next?: number } | undefined> {
		return await this.queue.getJobScheduler(GITHUB_SYNC_SCHEDULER_ID)
	}
}
