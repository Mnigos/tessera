import { Injectable, Logger } from '@nestjs/common'
import type { GitHubImportRepository } from '@repo/contracts'
import type { UserId } from '@repo/domain'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'
import { GitHubImportRepository as GitHubImportAccountsRepository } from '../infrastructure/github-import.repository'
import { GitHubOctokitClient } from '../infrastructure/github-octokit.client'

const GITHUB_REPOSITORIES_PER_PAGE = 100

@Injectable()
export class GitHubImportService {
	private readonly logger = new Logger(GitHubImportService.name)

	constructor(
		private readonly githubImportRepository: GitHubImportAccountsRepository,
		private readonly githubOctokitClient: GitHubOctokitClient
	) {}

	async listRepositories(userId: UserId): Promise<GitHubImportRepository[]> {
		const account = await this.githubImportRepository.findGitHubAccount({
			userId,
		})

		if (!account?.accessToken)
			throw new GitHubImportAuthenticationError({
				reason: 'missing_github_account_token',
				userId,
			})

		const octokit = this.githubOctokitClient.createForUser(account.accessToken)

		try {
			const repositories = await octokit.paginate(
				octokit.rest.repos.listForAuthenticatedUser,
				{
					visibility: 'all',
					sort: 'pushed',
					direction: 'desc',
					per_page: GITHUB_REPOSITORIES_PER_PAGE,
				}
			)

			return repositories.map(repository => ({
				githubId: repository.id,
				ownerLogin: repository.owner.login,
				name: repository.name,
				fullName: repository.full_name,
				visibility: getRepositoryVisibility(repository),
				defaultBranch: repository.default_branch,
				pushedAt: repository.pushed_at
					? new Date(repository.pushed_at)
					: undefined,
				githubUrl: repository.html_url,
			}))
		} catch (error) {
			if (isGitHubRequestError(error, 401)) {
				this.logger.warn('GitHub repository listing was unauthorized')
				throw new GitHubImportAuthenticationError({
					reason: 'github_unauthorized',
				})
			}

			if (isGitHubRequestError(error, 403)) {
				this.logger.warn('GitHub repository listing was forbidden')
				throw new GitHubImportForbiddenError({ reason: 'github_forbidden' })
			}

			if (isGitHubRequestError(error)) {
				this.logger.warn(
					`GitHub repository listing failed with status ${error.status}`
				)
				throw new GitHubImportExternalServiceError(
					{
						reason: 'github_unexpected_status',
						status: error.status,
					},
					{ cause: error }
				)
			}

			this.logger.error('GitHub repository listing failed', error)
			throw new GitHubImportExternalServiceError(
				{ reason: 'github_request_failed' },
				{ cause: error }
			)
		}
	}
}

interface GitHubRequestErrorLike {
	status: number
}

function isGitHubRequestError(
	error: unknown,
	status?: number
): error is GitHubRequestErrorLike {
	if (!error || typeof error !== 'object' || !('status' in error)) return false
	if (typeof error.status !== 'number') return false

	return status === undefined || error.status === status
}

interface GitHubRepositoryVisibilityInput {
	private: boolean
	visibility?: string
}

function getRepositoryVisibility({
	private: isPrivate,
	visibility,
}: GitHubRepositoryVisibilityInput): GitHubImportRepository['visibility'] {
	if (
		visibility === 'public' ||
		visibility === 'private' ||
		visibility === 'internal'
	)
		return visibility

	return isPrivate ? 'private' : 'public'
}
