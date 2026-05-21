import {
	normalizeGeneratedRepositorySlug,
	normalizeRepositorySlug,
} from '@modules/repositories/domain/repository.helpers'
import { Injectable } from '@nestjs/common'
import type {
	CreateGitHubRepositoryImportInput,
	GetGitHubRepositoryImportInput,
	GitHubImportRepository,
	GitHubRepositoryImport,
} from '@repo/contracts'
import type { RepositoryImportId } from '@repo/db'
import type { RepositorySlug, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	GitHubImportAuthenticationError,
	GitHubImportDuplicateActiveSourceError,
	GitHubImportNotFoundError,
	GitHubImportTargetSlugUnavailableError,
} from '../domain/github-import.errors'
import {
	hasGitHubRepoScope,
	toGitHubRepositoryImport,
} from '../helpers/github-import.helpers'
import { GitHubImportQueue } from '../infrastructure/github-import.queue'
import { GitHubImportRepository as GitHubImportAccountsRepository } from '../infrastructure/github-import.repository'
import { GitHubOctokitClient } from '../infrastructure/github-octokit.client'

const ACTIVE_SOURCE_UNIQUE_CONSTRAINT =
	'repository_imports_active_source_unique'
const ACTIVE_TARGET_SLUG_UNIQUE_CONSTRAINT =
	'repository_imports_active_target_slug_unique'
const ACTIVE_SOURCE_UNIQUE_CONSTRAINTS = new Set([
	ACTIVE_SOURCE_UNIQUE_CONSTRAINT,
])
const ACTIVE_TARGET_SLUG_UNIQUE_CONSTRAINTS = new Set([
	ACTIVE_TARGET_SLUG_UNIQUE_CONSTRAINT,
])

@Injectable()
export class GitHubImportService {
	constructor(
		private readonly githubImportRepository: GitHubImportAccountsRepository,
		private readonly githubOctokitClient: GitHubOctokitClient,
		private readonly githubImportQueue: GitHubImportQueue
	) {}

	async listRepositories(userId: UserId): Promise<GitHubImportRepository[]> {
		const account = await this.requireGitHubAccount(userId)

		return await this.githubOctokitClient.listRepositories({
			accessToken: account.accessToken,
		})
	}

	async createImport(
		userId: UserId,
		input: CreateGitHubRepositoryImportInput
	): Promise<GitHubRepositoryImport> {
		const account = await this.requireGitHubAccount(userId)
		const repository = await this.githubOctokitClient.getRepository({
			accessToken: account.accessToken,
			githubId: input.githubId,
		})
		const targetSlug = input.targetSlug
			? normalizeRepositorySlug(input.targetSlug)
			: normalizeGeneratedRepositorySlug(repository.name)

		await this.assertImportAvailable({
			githubId: repository.githubId,
			targetSlug,
			userId,
		})

		const repositoryImport = await this.createAvailableImport({
			userId,
			targetSlug,
			repository,
		})

		try {
			await this.githubImportQueue.enqueueRepositoryImport(repositoryImport.id)
		} catch (error) {
			await this.githubImportRepository.markFailed({
				importId: repositoryImport.id,
				failureReason:
					error instanceof Error
						? error.message
						: 'GitHub import enqueue failed',
			})

			throw error
		}

		return toGitHubRepositoryImport(repositoryImport)
	}

	async listImports(userId: UserId): Promise<GitHubRepositoryImport[]> {
		const imports = await this.githubImportRepository.listImports({ userId })

		return imports.map(toGitHubRepositoryImport)
	}

	async getImport(
		userId: UserId,
		{ id }: GetGitHubRepositoryImportInput
	): Promise<GitHubRepositoryImport> {
		const repositoryImport = await this.githubImportRepository.findImport({
			userId,
			importId: id as RepositoryImportId,
		})

		if (!repositoryImport) throw new GitHubImportNotFoundError({ id })

		return toGitHubRepositoryImport(repositoryImport)
	}

	private async requireGitHubAccount(userId: UserId) {
		const account = await this.githubImportRepository.findGitHubAccount({
			userId,
		})

		if (!account?.accessToken)
			throw new GitHubImportAuthenticationError({
				reason: 'missing_github_account_token',
				userId,
			})
		if (!(account.scope && hasGitHubRepoScope(account.scope)))
			throw new GitHubImportAuthenticationError({
				reason: 'missing_github_repo_scope',
				scope: account.scope,
				userId,
			})

		return {
			...account,
			accessToken: account.accessToken,
		}
	}

	private async assertImportAvailable({
		githubId,
		targetSlug,
		userId,
	}: {
		githubId: string
		targetSlug: RepositorySlug
		userId: UserId
	}) {
		const [hasActiveSource, hasRepositoryTargetSlug, hasActiveTargetSlug] =
			await Promise.all([
				this.githubImportRepository.hasActiveSource({ userId, githubId }),
				this.githubImportRepository.hasRepositoryTargetSlug({
					userId,
					targetSlug,
				}),
				this.githubImportRepository.hasActiveTargetSlug({ userId, targetSlug }),
			])

		if (hasActiveSource)
			throw new GitHubImportDuplicateActiveSourceError({ githubId, userId })

		if (hasRepositoryTargetSlug || hasActiveTargetSlug)
			throw new GitHubImportTargetSlugUnavailableError({
				targetSlug,
				userId,
			})
	}

	private async createAvailableImport({
		repository,
		targetSlug,
		userId,
	}: {
		repository: GitHubImportRepository
		targetSlug: RepositorySlug
		userId: UserId
	}) {
		try {
			return await this.githubImportRepository.createImport({
				userId,
				targetSlug,
				repository,
			})
		} catch (error) {
			if (isUniqueViolation(error, ACTIVE_SOURCE_UNIQUE_CONSTRAINTS))
				throw new GitHubImportDuplicateActiveSourceError({
					githubId: repository.githubId,
					userId,
				})

			if (isUniqueViolation(error, ACTIVE_TARGET_SLUG_UNIQUE_CONSTRAINTS))
				throw new GitHubImportTargetSlugUnavailableError({
					targetSlug,
					userId,
				})

			throw error
		}
	}
}
