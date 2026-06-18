import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import {
	GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
	GITHUB_MIRROR_SYNC_QUEUE_NAME,
	type GitHubMirrorSyncJobData,
	GitHubMirrorSyncQueue,
	type GitHubMirrorSyncRepositoryJobData,
} from '../infrastructure/github-mirror-sync.queue'
import {
	type GitHubMirrorSyncRepository,
	RepositoriesRepository,
} from '../infrastructure/repositories.repository'

const GITHUB_MIRROR_SYNC_MAX_BACKOFF_MINUTES = 24 * 60
const GITHUB_MIRROR_SYNC_SCHEDULE_ENQUEUE_FAILURE_REASON =
	'Scheduled GitHub mirror sync could not be queued. Please retry.'

@Injectable()
@Processor(GITHUB_MIRROR_SYNC_QUEUE_NAME, { concurrency: 1 })
export class GitHubMirrorSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubMirrorSyncProcessor.name)

	constructor(
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly gitStorageClient: GitStorageClient,
		private readonly githubMirrorSyncQueue: GitHubMirrorSyncQueue,
		private readonly envService: EnvService
	) {
		super()
	}

	async process(job: Job<GitHubMirrorSyncJobData>): Promise<void> {
		if (job.name === GITHUB_MIRROR_SYNC_DISPATCHER_JOB) {
			await this.dispatchDueSyncs()
			return
		}

		if (!isRepositorySyncJobData(job.data)) return

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

			if (!account?.accessToken) {
				await this.repositoriesRepository.markGitHubMirrorSyncFailed({
					repositoryId,
					failedAt: new Date(),
					failureReason: 'missing GitHub access token',
					nextSyncAt: null,
				})
				this.logger.warn(
					'GitHub mirror sync blocked because requester GitHub token is missing'
				)
				return
			}

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
			const nextSyncAt = addMinutes(
				completedAt,
				this.envService.get('GITHUB_MIRROR_SYNC_INTERVAL_MINUTES')
			)
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
					lastSyncFailedAt: null,
					nextSyncAt,
					syncFailureCount: 0,
					syncFailureReason: null,
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

			const failedAt = new Date()
			await this.repositoriesRepository.markGitHubMirrorSyncFailed({
				repositoryId,
				failedAt,
				failureReason,
				nextSyncAt: getTransientFailureNextSyncAt({
					failedAt,
					intervalMinutes: this.envService.get(
						'GITHUB_MIRROR_SYNC_INTERVAL_MINUTES'
					),
					syncFailureCount: repository.externalSource.syncFailureCount,
				}),
				syncFailureCount: repository.externalSource.syncFailureCount + 1,
			})
			this.logger.error(
				'GitHub mirror sync failed',
				error instanceof Error ? error.stack : undefined
			)
			throw error
		}
	}

	private async dispatchDueSyncs(): Promise<void> {
		const repositories =
			await this.repositoriesRepository.claimDueGitHubMirrorSyncRepositories({
				limit: this.envService.get('GITHUB_MIRROR_SYNC_BATCH_SIZE'),
				now: new Date(),
			})

		for (const repository of repositories) {
			try {
				await this.githubMirrorSyncQueue.enqueueRepositorySync({
					repositoryId: repository.id,
					requesterUserId: repository.ownerUserId,
				})
			} catch (error) {
				this.logger.error(
					'Failed to enqueue scheduled GitHub mirror sync job',
					error instanceof Error ? error.stack : undefined
				)
				await this.markScheduledEnqueueFailure(repository)
			}
		}
	}

	private async markScheduledEnqueueFailure(
		repository: GitHubMirrorSyncRepository
	): Promise<void> {
		const failedAt = new Date()

		try {
			await this.repositoriesRepository.markGitHubMirrorSyncFailed({
				repositoryId: repository.id,
				failedAt,
				failureReason: GITHUB_MIRROR_SYNC_SCHEDULE_ENQUEUE_FAILURE_REASON,
				nextSyncAt: getTransientFailureNextSyncAt({
					failedAt,
					intervalMinutes: this.envService.get(
						'GITHUB_MIRROR_SYNC_INTERVAL_MINUTES'
					),
					syncFailureCount: repository.externalSource.syncFailureCount,
				}),
				syncFailureCount: repository.externalSource.syncFailureCount + 1,
			})
		} catch (error) {
			this.logger.error(
				'Failed to mark scheduled GitHub mirror sync enqueue failure',
				error instanceof Error ? error.stack : undefined
			)
		}
	}
}

function isFinalJobAttempt({
	attemptsMade,
	opts,
}: Job<GitHubMirrorSyncJobData>) {
	const attempts = opts.attempts ?? 1

	return attemptsMade + 1 >= attempts
}

function isRepositorySyncJobData(
	data: GitHubMirrorSyncJobData
): data is GitHubMirrorSyncRepositoryJobData {
	return 'repositoryId' in data
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000)
}

function getTransientFailureNextSyncAt({
	failedAt,
	intervalMinutes,
	syncFailureCount,
}: {
	failedAt: Date
	intervalMinutes: number
	syncFailureCount: number
}): Date {
	const nextFailureCount = syncFailureCount + 1
	const backoffMinutes = Math.min(
		intervalMinutes * 2 ** (nextFailureCount - 1),
		GITHUB_MIRROR_SYNC_MAX_BACKOFF_MINUTES
	)

	return addMinutes(failedAt, backoffMinutes)
}
