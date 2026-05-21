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
const GITHUB_REPOSITORIES_LIMIT = 100

interface ListRepositoriesParams {
	accessToken: string
}

interface GetRepositoryParams extends ListRepositoriesParams {
	githubId: string
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
				},
				(response, done) => {
					done()
					return response.data.slice(0, GITHUB_REPOSITORIES_LIMIT)
				}
			)

			return repositories.map(repository => ({
				githubId: repository.id.toString(),
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
			throw this.mapRepositoryRequestError(error, 'listing')
		}
	}

	async getRepository({
		accessToken,
		githubId,
	}: GetRepositoryParams): Promise<GitHubImportRepository> {
		const octokit = this.createForUser(accessToken)

		try {
			const response = await octokit.request(
				'GET /repositories/{repository_id}',
				{
					repository_id: githubId,
				}
			)

			return {
				githubId: response.data.id.toString(),
				ownerLogin: response.data.owner.login,
				name: response.data.name,
				fullName: response.data.full_name,
				visibility: getRepositoryVisibility(response.data),
				defaultBranch: response.data.default_branch,
				pushedAt: response.data.pushed_at
					? new Date(response.data.pushed_at)
					: undefined,
				githubUrl: response.data.html_url,
			}
		} catch (error) {
			throw this.mapRepositoryRequestError(error, 'fetching')
		}
	}

	createForUser(accessToken: string) {
		return new Octokit({ auth: accessToken })
	}

	private mapRepositoryRequestError(error: unknown, action: string) {
		if (isGitHubRequestError(error, 401)) {
			this.logger.warn(`GitHub repository ${action} was unauthorized`)
			return new GitHubImportAuthenticationError({
				reason: 'github_unauthorized',
			})
		}

		if (isGitHubRequestError(error, 403)) {
			this.logger.warn(`GitHub repository ${action} was forbidden`)
			return new GitHubImportForbiddenError({ reason: 'github_forbidden' })
		}

		if (isGitHubRequestError(error)) {
			this.logger.warn(
				`GitHub repository ${action} failed with status ${error.status}`
			)
			return new GitHubImportExternalServiceError(
				{
					reason: 'github_unexpected_status',
					status: error.status,
				},
				{ cause: error }
			)
		}

		this.logger.error(`GitHub repository ${action} failed`, error)
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
