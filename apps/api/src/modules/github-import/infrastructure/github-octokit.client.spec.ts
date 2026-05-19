import { Logger } from '@nestjs/common'
import type { GitHubImportRepository } from '@repo/contracts'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'
import { GitHubOctokitClient } from './github-octokit.client'

const repository: GitHubImportRepository = {
	githubId: 123,
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
	let paginate: ReturnType<typeof vi.fn>
	const listForAuthenticatedUser = vi.fn()

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		paginate = vi.fn()
		githubOctokitClient = new GitHubOctokitClient()
		vi.spyOn(githubOctokitClient, 'createForUser').mockReturnValue({
			paginate,
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
		paginate.mockResolvedValue([githubRepositoryResponse])

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
			})
		).toEqual([repository])
		expect(githubOctokitClient.createForUser).toHaveBeenCalledWith(
			'github-token'
		)
		expect(paginate).toHaveBeenCalledWith(listForAuthenticatedUser, {
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 100,
		})
	})

	test('falls back to private visibility when GitHub omits visibility', async () => {
		paginate.mockResolvedValue([
			{
				...githubRepositoryResponse,
				visibility: undefined,
				private: true,
			},
		])

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
			})
		).toEqual([repository])
	})

	test('maps GitHub 401 responses to an authentication error', async () => {
		paginate.mockRejectedValue({ status: 401 })

		await expect(
			githubOctokitClient.listRepositories({ accessToken: 'github-token' })
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
	})

	test('maps GitHub 403 responses to a forbidden error', async () => {
		paginate.mockRejectedValue({ status: 403 })

		await expect(
			githubOctokitClient.listRepositories({ accessToken: 'github-token' })
		).rejects.toBeInstanceOf(GitHubImportForbiddenError)
	})

	test('maps unexpected GitHub statuses to an external service error', async () => {
		paginate.mockRejectedValue({ status: 500 })

		await expect(
			githubOctokitClient.listRepositories({ accessToken: 'github-token' })
		).rejects.toBeInstanceOf(GitHubImportExternalServiceError)
	})

	test('maps GitHub request failures to an external service error', async () => {
		paginate.mockRejectedValue(new Error('socket closed'))

		await expect(
			githubOctokitClient.listRepositories({ accessToken: 'github-token' })
		).rejects.toBeInstanceOf(GitHubImportExternalServiceError)
	})
})
