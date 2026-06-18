import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { RepositoryId, UserId } from '@repo/domain'
import type { Queue } from 'bullmq'

export const GITHUB_MIRROR_SYNC_QUEUE_NAME = 'github-mirror-sync'
export const GITHUB_MIRROR_SYNC_REPOSITORY_JOB = 'github-mirror-sync.repository'
export const GITHUB_MIRROR_SYNC_DISPATCHER_JOB = 'github-mirror-sync.dispatcher'
export const GITHUB_MIRROR_SYNC_SCHEDULER_ID =
	'github-mirror-sync-dispatcher-scheduler'
const GITHUB_MIRROR_SYNC_JOB_ATTEMPTS = 3
const GITHUB_MIRROR_SYNC_JOB_BACKOFF_DELAY_MS = 10_000
const REUSABLE_REPOSITORY_JOB_STATES = new Set([
	'delayed',
	'prioritized',
	'waiting',
	'waiting-children',
])

export interface GitHubMirrorSyncDispatcherJobData {
	type: 'dispatcher'
}

export interface GitHubMirrorSyncRepositoryJobData {
	repositoryId: RepositoryId
	requesterUserId: UserId
}

export type GitHubMirrorSyncJobData =
	| GitHubMirrorSyncDispatcherJobData
	| GitHubMirrorSyncRepositoryJobData

export class GitHubMirrorSyncJobAlreadyActiveError extends Error {
	constructor(repositoryId: RepositoryId) {
		super(
			`GitHub mirror sync job is already active for repository ${repositoryId}`
		)
	}
}

@Injectable()
export class GitHubMirrorSyncQueue {
	constructor(
		@InjectQueue(GITHUB_MIRROR_SYNC_QUEUE_NAME)
		private readonly queue: Queue<GitHubMirrorSyncJobData>
	) {}

	async enqueueRepositorySync({
		repositoryId,
		requesterUserId,
	}: GitHubMirrorSyncRepositoryJobData): Promise<void> {
		const existingJob = await this.queue.getJob(repositoryId)
		if (existingJob) {
			const state = await existingJob.getState()
			if (REUSABLE_REPOSITORY_JOB_STATES.has(state)) return
			if (state === 'active')
				throw new GitHubMirrorSyncJobAlreadyActiveError(repositoryId)

			const removedJobCount = await this.queue.remove(repositoryId, {
				removeChildren: true,
			})
			if (removedJobCount === 0)
				throw new GitHubMirrorSyncJobAlreadyActiveError(repositoryId)
		}

		await this.queue.add(
			GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
			{ repositoryId, requesterUserId },
			{
				attempts: GITHUB_MIRROR_SYNC_JOB_ATTEMPTS,
				backoff: {
					type: 'exponential',
					delay: GITHUB_MIRROR_SYNC_JOB_BACKOFF_DELAY_MS,
				},
				jobId: repositoryId,
				removeOnComplete: true,
				removeOnFail: true,
			}
		)
	}

	async scheduleDispatcher(crontime: string): Promise<void> {
		await this.queue.upsertJobScheduler(
			GITHUB_MIRROR_SYNC_SCHEDULER_ID,
			{ pattern: crontime },
			{
				name: GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
				data: { type: 'dispatcher' },
			}
		)
	}

	async getDispatcherSchedule(): Promise<{ next?: number } | undefined> {
		return await this.queue.getJobScheduler(GITHUB_MIRROR_SYNC_SCHEDULER_ID)
	}
}
