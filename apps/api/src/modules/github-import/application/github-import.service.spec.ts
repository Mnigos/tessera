import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubImportRepository as GitHubImportRepositoryOutput } from '@repo/contracts'
import { mockUserId } from '~/shared/test-utils'
import { GitHubImportAuthenticationError } from '../domain/github-import.errors'
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

describe(GitHubImportService.name, () => {
	let moduleRef: TestingModule
	let githubImportService: GitHubImportService
	let githubImportRepository: GitHubImportRepository
	let githubOctokitClient: GitHubOctokitClient

	beforeEach(async () => {
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
						listRepositories: vi.fn(),
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
		const listRepositoriesSpy = vi
			.spyOn(githubOctokitClient, 'listRepositories')
			.mockResolvedValue([repository])

		expect(await githubImportService.listRepositories(mockUserId)).toEqual([
			repository,
		])
		expect(findGitHubAccountSpy).toHaveBeenCalledWith({ userId: mockUserId })
		expect(listRepositoriesSpy).toHaveBeenCalledWith({
			accessToken: 'github-token',
		})
	})

	test('returns an empty list from GitHub', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubOctokitClient, 'listRepositories').mockResolvedValue([])

		expect(await githubImportService.listRepositories(mockUserId)).toEqual([])
	})

	test('rejects when the user has no GitHub account', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue(
			undefined
		)

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
		expect(githubOctokitClient.listRepositories).not.toHaveBeenCalled()
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
		expect(githubOctokitClient.listRepositories).not.toHaveBeenCalled()
	})
})
