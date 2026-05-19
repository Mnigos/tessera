import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import type {
	GitHubImportRepository,
	GitHubImportRepositoryVisibility,
} from '@repo/contracts'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'

const GITHUB_REPOSITORIES_PER_PAGE = 100

interface ListRepositoriesParams {
	accessToken: string
}

interface GitHubRequestErrorLike {
	status: number
}

interface GitHubRepositoryVisibilityInput {
	private: boolean
	visibility?: string
}

@Injectable()
export class GitHubOctokitClient {
	private readonly logger = new Logger(GitHubOctokitClient.name)

	async listRepositories({
		accessToken,
	}: ListRepositoriesParams): Promise<GitHubImportRepository[]> {
		const octokit = this.createForUser(accessToken)

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
			throw this.mapRepositoryListError(error)
		}
	}

	createForUser(accessToken: string) {
		return new Octokit({ auth: accessToken })
	}

	private mapRepositoryListError(error: unknown) {
		if (isGitHubRequestError(error, 401)) {
			this.logger.warn('GitHub repository listing was unauthorized')
			return new GitHubImportAuthenticationError({
				reason: 'github_unauthorized',
			})
		}

		if (isGitHubRequestError(error, 403)) {
			this.logger.warn('GitHub repository listing was forbidden')
			return new GitHubImportForbiddenError({ reason: 'github_forbidden' })
		}

		if (isGitHubRequestError(error)) {
			this.logger.warn(
				`GitHub repository listing failed with status ${error.status}`
			)
			return new GitHubImportExternalServiceError(
				{
					reason: 'github_unexpected_status',
					status: error.status,
				},
				{ cause: error }
			)
		}

		this.logger.error('GitHub repository listing failed', error)
		return new GitHubImportExternalServiceError(
			{ reason: 'github_request_failed' },
			{ cause: error }
		)
	}
}

function isGitHubRequestError(
	error: unknown,
	status?: number
): error is GitHubRequestErrorLike {
	if (!error || typeof error !== 'object' || !('status' in error)) return false
	if (typeof error.status !== 'number') return false

	return status === undefined || error.status === status
}

function getRepositoryVisibility({
	private: isPrivate,
	visibility,
}: GitHubRepositoryVisibilityInput): GitHubImportRepositoryVisibility {
	if (
		visibility === 'public' ||
		visibility === 'private' ||
		visibility === 'internal'
	)
		return visibility

	return isPrivate ? 'private' : 'public'
}
