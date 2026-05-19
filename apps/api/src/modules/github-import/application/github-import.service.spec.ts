import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubImportRepository as GitHubImportRepositoryOutput } from '@repo/contracts'
import { mockUserId } from '~/shared/test-utils'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'
import { GitHubImportRepository } from '../infrastructure/github-import.repository'
import { GitHubOctokitClient } from '../infrastructure/github-octokit.client'
import { GitHubImportService } from './github-import.service'

const repository: GitHubImportRepositoryOutput = {
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
	default_branch: 'main',
	pushed_at: '2026-05-10T12:34:56Z',
	html_url: 'https://github.com/marta/tessera',
}

describe(GitHubImportService.name, () => {
	let moduleRef: TestingModule
	let githubImportService: GitHubImportService
	let githubImportRepository: GitHubImportRepository
	let githubOctokitClient: GitHubOctokitClient
	let paginate: ReturnType<typeof vi.fn>
	const listForAuthenticatedUser = vi.fn()

	beforeEach(async () => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		paginate = vi.fn()
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubImportService,
				{
					provide: GitHubImportRepository,
					useValue: {
						findGitHubAccount: vi.fn(),
					},
				},
				{
					provide: GitHubOctokitClient,
					useValue: {
						createForUser: vi.fn(() => ({
							paginate,
							rest: {
								repos: {
									listForAuthenticatedUser,
								},
							},
						})),
					},
				},
			],
		}).compile()

		githubImportService = moduleRef.get(GitHubImportService)
		githubImportRepository = moduleRef.get(GitHubImportRepository)
		githubOctokitClient = moduleRef.get(GitHubOctokitClient)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists GitHub repositories with a stored GitHub access token', async () => {
		const findGitHubAccountSpy = vi
			.spyOn(githubImportRepository, 'findGitHubAccount')
			.mockResolvedValue({
				accessToken: 'github-token',
				scope: 'repo',
				accessTokenExpiresAt: null,
			})
		const createForUserSpy = vi.spyOn(githubOctokitClient, 'createForUser')
		paginate.mockResolvedValue([githubRepositoryResponse])

		expect(await githubImportService.listRepositories(mockUserId)).toEqual([
			repository,
		])
		expect(findGitHubAccountSpy).toHaveBeenCalledWith({ userId: mockUserId })
		expect(createForUserSpy).toHaveBeenCalledWith('github-token')
		expect(paginate).toHaveBeenCalledWith(listForAuthenticatedUser, {
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 100,
		})
	})

	test('returns an empty list from GitHub', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		paginate.mockResolvedValue([])

		expect(await githubImportService.listRepositories(mockUserId)).toEqual([])
	})

	test('rejects when the user has no GitHub account', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue(
			undefined
		)

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
		expect(githubOctokitClient.createForUser).not.toHaveBeenCalled()
	})

	test('rejects when the GitHub account has no access token', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: null,
			scope: 'repo',
			accessTokenExpiresAt: null,
		})

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
		expect(githubOctokitClient.createForUser).not.toHaveBeenCalled()
	})

	test('maps GitHub 401 responses to an authentication error', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		paginate.mockRejectedValue({ status: 401 })

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
	})

	test('maps GitHub 403 responses to a forbidden error', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		paginate.mockRejectedValue({ status: 403 })

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportForbiddenError)
	})

	test('maps GitHub failures to an external service error', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		paginate.mockRejectedValue(new Error('socket closed'))

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportExternalServiceError)
	})
})
