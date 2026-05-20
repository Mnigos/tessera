import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories/application/repositories.service'
import { DuplicateRepositorySlugError } from '@modules/repositories/domain/repository.errors'
import { normalizeRepositoryName } from '@modules/repositories/domain/repository.helpers'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { RepositoryId } from '@repo/domain'
import type { Job } from 'bullmq'
import { ServiceUnavailableError } from '~/shared/errors'
import type { GitHubImportRepositoryJobData } from '../infrastructure/github-import.queue'
import { GITHUB_IMPORT_QUEUE_NAME } from '../infrastructure/github-import.queue'
import { GitHubImportRepository } from '../infrastructure/github-import.repository'

@Injectable()
@Processor(GITHUB_IMPORT_QUEUE_NAME)
export class GitHubImportProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubImportProcessor.name)

	constructor(
		private readonly githubImportRepository: GitHubImportRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {
		super()
	}

	async process(job: Job<GitHubImportRepositoryJobData>): Promise<void> {
		const { data } = job
		const repositoryImport = await this.githubImportRepository.markRunning({
			importId: data.importId,
		})

		if (!repositoryImport) return

		let repositoryId: RepositoryId | undefined
		let didCreateStorage = false

		try {
			const [account, username] = await Promise.all([
				this.githubImportRepository.findGitHubAccount({
					userId: repositoryImport.ownerUserId,
				}),
				this.githubImportRepository.findOwnerUsername({
					userId: repositoryImport.ownerUserId,
				}),
			])

			if (!account?.accessToken) throw new Error('missing GitHub access token')
			if (!username) throw new Error('missing owner username')

			const repository =
				await this.repositoriesService.createImportedRepositoryMetadata({
					userId: repositoryImport.ownerUserId,
					username,
					name: normalizeRepositoryName(repositoryImport.sourceName),
					slug: repositoryImport.targetSlug,
					visibility:
						repositoryImport.sourceVisibility === 'public'
							? 'public'
							: 'private',
				})
			repositoryId = repository.id

			const { storagePath } = await this.gitStorageClient.createRepository({
				repositoryId: repository.id,
			})
			didCreateStorage = true
			const importResult = await this.gitStorageClient.importRepository({
				repositoryId: repository.id,
				storagePath,
				sourceUrl: repositoryImport.sourceGithubUrl,
				accessToken: account.accessToken,
				defaultBranchHint: repositoryImport.sourceDefaultBranch,
			})

			const repositoryWithStorage =
				await this.repositoriesService.updateImportedRepositoryStorage({
					repositoryId: repository.id,
					username,
					storagePath: importResult.storagePath,
					defaultBranch:
						importResult.defaultBranch || repositoryImport.sourceDefaultBranch,
				})

			if (!repositoryWithStorage)
				throw new Error('failed to update imported repository storage')

			await this.githubImportRepository.markSucceeded({
				importId: repositoryImport.id,
				repositoryId: repository.id,
			})
		} catch (error) {
			const failureReason =
				error instanceof Error ? error.message : 'GitHub import failed'
			if (error instanceof DuplicateRepositorySlugError) {
				await this.githubImportRepository.markFailed({
					importId: repositoryImport.id,
					failureReason,
				})
				this.logger.warn(
					'GitHub repository import target slug already exists; marking failed'
				)
				return
			}
			const isFinalAttempt = isFinalJobAttempt(job)

			if (isFinalAttempt || didCreateStorage)
				await this.githubImportRepository.markFailed({
					importId: repositoryImport.id,
					failureReason,
				})

			if (repositoryId)
				await this.repositoriesService.deleteRepositoryMetadata(repositoryId)

			this.logImportFailure(error, isFinalAttempt)

			if (!(isFinalAttempt || didCreateStorage)) throw error
		}
	}

	private logImportFailure(error: unknown, isFinalAttempt: boolean) {
		if (error instanceof ServiceUnavailableError && !isFinalAttempt) {
			this.logger.warn(
				'GitHub repository import dependency unavailable; retrying'
			)
			return
		}

		this.logger.error(
			'GitHub repository import failed',
			error instanceof Error ? error.stack : undefined
		)
	}
}

function isFinalJobAttempt({
	attemptsMade,
	opts,
}: Job<GitHubImportRepositoryJobData>) {
	const attempts = opts.attempts ?? 1

	return attemptsMade + 1 >= attempts
}
