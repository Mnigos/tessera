import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { RepositoryId, UserId } from '@repo/domain'
import type { Queue } from 'bullmq'

export const GITHUB_MIRROR_SYNC_QUEUE_NAME = 'github-mirror-sync'
export const GITHUB_MIRROR_SYNC_REPOSITORY_JOB = 'github-mirror-sync.repository'
const GITHUB_MIRROR_SYNC_JOB_ATTEMPTS = 3
const GITHUB_MIRROR_SYNC_JOB_BACKOFF_DELAY_MS = 10_000

export interface GitHubMirrorSyncRepositoryJobData {
	repositoryId: RepositoryId
	requesterUserId: UserId
}

@Injectable()
export class GitHubMirrorSyncQueue {
	constructor(
		@InjectQueue(GITHUB_MIRROR_SYNC_QUEUE_NAME)
		private readonly queue: Queue<GitHubMirrorSyncRepositoryJobData>
	) {}

	async enqueueRepositorySync({
		repositoryId,
		requesterUserId,
	}: GitHubMirrorSyncRepositoryJobData): Promise<void> {
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
}
