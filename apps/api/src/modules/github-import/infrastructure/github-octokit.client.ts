import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import type {
	GitHubImportRepositoriesOutput,
	GitHubImportRepository,
	GitHubImportRepositoryVisibility,
	ParsedListGitHubImportRepositoriesInput,
} from '@repo/contracts'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'

const GITHUB_REPOSITORIES_PER_PAGE = 50
const GITHUB_SEARCH_SCAN_PAGES = 4
const NEXT_PAGE_LINK_REGEX = /rel="next"/

interface ListRepositoriesParams
	extends ParsedListGitHubImportRepositoriesInput {
	accessToken: string
}

interface GetRepositoryParams {
	accessToken: string
	githubId: string
}

interface GitHubRequestErrorLike {
	status: number
}

interface GitHubRepositoryVisibilityInput {
	private: boolean
	visibility?: string
}

interface GitHubRepositoryInput extends GitHubRepositoryVisibilityInput {
	id: number
	owner: { login: string }
	name: string
	full_name: string
	default_branch: string
	pushed_at?: string | null
	html_url: string
}

@Injectable()
export class GitHubOctokitClient {
	private readonly logger = new Logger(GitHubOctokitClient.name)

	// GitHub's search API cannot see collaborator or org repositories, so search filters the plain listing.
	async listRepositories({
		accessToken,
		page,
		search,
	}: ListRepositoriesParams): Promise<GitHubImportRepositoriesOutput> {
		const octokit = this.createForUser(accessToken)
		const pageCount = search ? GITHUB_SEARCH_SCAN_PAGES : 1
		const term = search?.toLowerCase()

		try {
			const responses = await Promise.all(
				Array.from({ length: pageCount }, (_, index) =>
					octokit.rest.repos.listForAuthenticatedUser({
						visibility: 'all',
						sort: 'pushed',
						direction: 'desc',
						per_page: GITHUB_REPOSITORIES_PER_PAGE,
						page: page + index,
					})
				)
			)
			const pages = responses.map(response => response.data)
			const shortPageIndex = pages.findIndex(
				rows => rows.length < GITHUB_REPOSITORIES_PER_PAGE
			)
			const hasNextPage =
				shortPageIndex === -1 &&
				NEXT_PAGE_LINK_REGEX.test(responses.at(-1)?.headers.link ?? '')

			return {
				repositories: (shortPageIndex === -1
					? pages
					: pages.slice(0, shortPageIndex + 1)
				)
					.flat()
					.filter(
						({ full_name }) => !term || full_name.toLowerCase().includes(term)
					)
					.map(toImportRepository),
				nextPage: hasNextPage ? page + pageCount : undefined,
			}
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

			return toImportRepository(response.data)
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

function toImportRepository(
	repository: GitHubRepositoryInput
): GitHubImportRepository {
	return {
		githubId: repository.id.toString(),
		ownerLogin: repository.owner.login,
		name: repository.name,
		fullName: repository.full_name,
		visibility: getRepositoryVisibility(repository),
		defaultBranch: repository.default_branch,
		pushedAt: repository.pushed_at ? new Date(repository.pushed_at) : undefined,
		githubUrl: repository.html_url,
	}
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
