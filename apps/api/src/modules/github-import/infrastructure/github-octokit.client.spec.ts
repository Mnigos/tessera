import { Logger } from '@nestjs/common'
import type { GitHubImportRepository } from '@repo/contracts'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'
import { GitHubOctokitClient } from './github-octokit.client'

const repository: GitHubImportRepository = {
	githubId: '123',
	ownerLogin: 'marta',
	name: 'tessera',
	fullName: 'marta/tessera',
	visibility: 'private',
	defaultBranch: 'main',
	pushedAt: new Date('2026-05-10T12:34:56Z'),
	githubUrl: 'https://github.com/marta/tessera',
}

const githubRepositoryResponse = {
	id: 123,
	owner: {
		login: 'marta',
	},
	name: 'tessera',
	full_name: 'marta/tessera',
	visibility: 'private' as const,
	private: true,
	default_branch: 'main',
	pushed_at: '2026-05-10T12:34:56Z',
	html_url: 'https://github.com/marta/tessera',
}

describe(GitHubOctokitClient.name, () => {
	let githubOctokitClient: GitHubOctokitClient
	let listForAuthenticatedUser: ReturnType<typeof vi.fn>
	let request: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		listForAuthenticatedUser = vi.fn()
		request = vi.fn()
		githubOctokitClient = new GitHubOctokitClient()
		vi.spyOn(githubOctokitClient, 'createForUser').mockReturnValue({
			request,
			rest: {
				repos: {
					listForAuthenticatedUser,
				},
			},
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('lists repositories with the authenticated GitHub user client', async () => {
		listForAuthenticatedUser.mockResolvedValue({
			data: [githubRepositoryResponse],
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).toEqual({ repositories: [repository], nextPage: undefined })
		expect(githubOctokitClient.createForUser).toHaveBeenCalledWith(
			'github-token'
		)
		expect(listForAuthenticatedUser).toHaveBeenCalledWith({
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 50,
			page: 1,
		})
	})

	test('fetches a repository by string GitHub id without numeric coercion', async () => {
		request.mockResolvedValue({ data: githubRepositoryResponse })

		expect(
			await githubOctokitClient.getRepository({
				accessToken: 'github-token',
				githubId: '9007199254740993',
			})
		).toEqual(repository)
		expect(request).toHaveBeenCalledWith('GET /repositories/{repository_id}', {
			repository_id: '9007199254740993',
		})
	})

	test('falls back to private visibility when GitHub omits visibility', async () => {
		listForAuthenticatedUser.mockResolvedValue({
			data: [
				{
					...githubRepositoryResponse,
					visibility: undefined,
					private: true,
				},
			],
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).toEqual({ repositories: [repository], nextPage: undefined })
	})

	test('maps GitHub 401 responses to an authentication error', async () => {
		listForAuthenticatedUser.mockRejectedValue({ status: 401 })

		await expect(
			githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
	})

	test('maps GitHub 403 responses to a forbidden error', async () => {
		listForAuthenticatedUser.mockRejectedValue({ status: 403 })

		await expect(
			githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).rejects.toBeInstanceOf(GitHubImportForbiddenError)
	})

	test('maps unexpected GitHub statuses to an external service error', async () => {
		listForAuthenticatedUser.mockRejectedValue({ status: 500 })

		await expect(
			githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).rejects.toBeInstanceOf(GitHubImportExternalServiceError)
	})

	test('maps GitHub request failures to an external service error', async () => {
		listForAuthenticatedUser.mockRejectedValue(new Error('socket closed'))

		await expect(
			githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).rejects.toBeInstanceOf(GitHubImportExternalServiceError)
	})
})
