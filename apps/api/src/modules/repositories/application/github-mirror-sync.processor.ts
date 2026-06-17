import { GitStorageClient } from '@config/git-storage'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import {
	GITHUB_MIRROR_SYNC_QUEUE_NAME,
	type GitHubMirrorSyncRepositoryJobData,
} from '../infrastructure/github-mirror-sync.queue'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

@Injectable()
@Processor(GITHUB_MIRROR_SYNC_QUEUE_NAME)
export class GitHubMirrorSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubMirrorSyncProcessor.name)

	constructor(
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly gitStorageClient: GitStorageClient
	) {
		super()
	}

	async process(job: Job<GitHubMirrorSyncRepositoryJobData>): Promise<void> {
		const { repositoryId, requesterUserId } = job.data
		const repository =
			await this.repositoriesRepository.markGitHubMirrorSyncRunning({
				repositoryId,
			})

		if (!repository) return

		try {
			const account = await this.repositoriesRepository.findGitHubAccount({
				userId: requesterUserId,
			})

			if (!account?.accessToken) throw new Error('missing GitHub access token')

			const startedAt = repository.externalSource.lastSyncStartedAt
			if (!startedAt) throw new Error('missing GitHub mirror sync start time')

			const importResult = await this.gitStorageClient.importRepository({
				repositoryId,
				storagePath: repository.storagePath,
				sourceUrl: repository.externalSource.sourceUrl,
				accessToken: account.accessToken,
				defaultBranchHint: repository.externalSource.sourceDefaultBranch,
			})
			const completedAt = new Date()
			const repositoryWithStorage =
				await this.repositoriesRepository.markGitHubMirrorSyncSucceeded({
					repositoryId,
					username: repository.ownerUser.username,
					storagePath: importResult.storagePath,
					defaultBranch:
						importResult.defaultBranch ||
						repository.externalSource.sourceDefaultBranch,
					externalRepositoryId: repository.externalSource.externalRepositoryId,
					ownerLogin: repository.externalSource.ownerLogin,
					name: repository.externalSource.name,
					fullName: repository.externalSource.fullName,
					sourceUrl: repository.externalSource.sourceUrl,
					sourceDefaultBranch: repository.externalSource.sourceDefaultBranch,
					mirrorMode: 'github_to_tessera',
					syncStatus: 'succeeded',
					lastSyncStartedAt: startedAt,
					lastSyncSucceededAt: completedAt,
					lastSyncFailedAt: undefined,
					syncFailureReason: undefined,
				})

			if (!repositoryWithStorage)
				throw new Error('failed to update synced GitHub mirror')
		} catch (error) {
			const failureReason =
				error instanceof Error ? error.message : 'GitHub mirror sync failed'
			const isFinalAttempt = isFinalJobAttempt(job)

			if (!isFinalAttempt) {
				this.logger.warn('GitHub mirror sync failed; retrying')
				throw error
			}

			await this.repositoriesRepository.markGitHubMirrorSyncFailed({
				repositoryId,
				failedAt: new Date(),
				failureReason,
			})
			this.logger.error(
				'GitHub mirror sync failed',
				error instanceof Error ? error.stack : undefined
			)
		}
	}
}

function isFinalJobAttempt({
	attemptsMade,
	opts,
}: Job<GitHubMirrorSyncRepositoryJobData>) {
	const attempts = opts.attempts ?? 1

	return attemptsMade + 1 >= attempts
}
