import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { GitHubSyncRequest } from './github-sync.repository'

export const GITHUB_SYNC_QUEUE_NAME = 'github-sync'
export const GITHUB_SYNC_REPOSITORY_JOB = 'github-sync.repository'
export const GITHUB_SYNC_DISPATCHER_JOB = 'github-sync.dispatcher'
export const GITHUB_SYNC_SCHEDULER_ID = 'github-sync-dispatcher-scheduler'
const GITHUB_SYNC_JOB_ATTEMPTS = 5
const GITHUB_SYNC_JOB_BACKOFF_DELAY_MS = 10_000

interface GitHubSyncDispatcherJobData {
	type: 'dispatcher'
}

export type GitHubSyncJobData = GitHubSyncRequest | GitHubSyncDispatcherJobData

export class GitHubSyncJobQueue extends Queue<GitHubSyncJobData> {}

@Injectable()
export class GitHubSyncQueue {
	constructor(private readonly queue: GitHubSyncJobQueue) {}

	async enqueue(request: GitHubSyncRequest): Promise<void> {
		await this.queue.add(GITHUB_SYNC_REPOSITORY_JOB, request, {
			attempts: GITHUB_SYNC_JOB_ATTEMPTS,
			backoff: {
				type: 'exponential',
				delay: GITHUB_SYNC_JOB_BACKOFF_DELAY_MS,
			},
			jobId: `${request.repositoryId}:${request.authorityGeneration}:${request.requestedSyncVersion}`,
			removeOnComplete: true,
			removeOnFail: true,
		})
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
