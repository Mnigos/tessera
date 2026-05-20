import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { RepositoryImportId } from '@repo/db'
import type { Queue } from 'bullmq'

export const GITHUB_IMPORT_QUEUE_NAME = 'github-import'
export const GITHUB_IMPORT_REPOSITORY_JOB = 'github-import.repository'
const GITHUB_IMPORT_JOB_ATTEMPTS = 10
const GITHUB_IMPORT_JOB_BACKOFF_DELAY_MS = 10_000

export interface GitHubImportRepositoryJobData {
	importId: RepositoryImportId
}

@Injectable()
export class GitHubImportQueue {
	constructor(
		@InjectQueue(GITHUB_IMPORT_QUEUE_NAME)
		private readonly queue: Queue<GitHubImportRepositoryJobData>
	) {}

	async enqueueRepositoryImport(importId: RepositoryImportId): Promise<void> {
		await this.queue.add(
			GITHUB_IMPORT_REPOSITORY_JOB,
			{ importId },
			{
				attempts: GITHUB_IMPORT_JOB_ATTEMPTS,
				backoff: {
					type: 'exponential',
					delay: GITHUB_IMPORT_JOB_BACKOFF_DELAY_MS,
				},
				jobId: importId,
			}
		)
	}
}
