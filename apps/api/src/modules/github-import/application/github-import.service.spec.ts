import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubImportRepository as GitHubImportRepositoryOutput,
	GitHubRepositoryImport,
} from '@repo/contracts'
import type { RepositoryImportId } from '@repo/db'
import type { RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	GitHubImportAuthenticationError,
	GitHubImportDuplicateActiveSourceError,
	GitHubImportTargetSlugUnavailableError,
} from '../domain/github-import.errors'
import { GitHubImportQueue } from '../infrastructure/github-import.queue'
import { GitHubImportRepository } from '../infrastructure/github-import.repository'
import { GitHubOctokitClient } from '../infrastructure/github-octokit.client'
import { GitHubImportService } from './github-import.service'

const repository: GitHubImportRepositoryOutput = {
	githubId: '123',
	ownerLogin: 'marta',
	name: 'tessera',
	fullName: 'marta/tessera',
	visibility: 'private',
	defaultBranch: 'main',
	pushedAt: new Date('2026-05-10T12:34:56Z'),
	githubUrl: 'https://github.com/marta/tessera',
}
const repositoryImportId =
	'00000000-0000-4000-8000-000000000029' as RepositoryImportId
const repositoryImport = {
	id: repositoryImportId,
	ownerUserId: mockUserId,
	repositoryId: null,
	provider: 'github' as const,
	targetName: repository.name,
	targetSlug: 'tessera' as RepositorySlug,
	sourceGithubId: BigInt(repository.githubId),
	sourceOwnerLogin: repository.ownerLogin,
	sourceName: repository.name,
	sourceFullName: repository.fullName,
	sourceVisibility: repository.visibility,
	sourceDefaultBranch: repository.defaultBranch,
	sourceGithubUrl: repository.githubUrl,
	status: 'pending' as const,
	failureReason: null,
	startedAt: null,
	completedAt: null,
	createdAt: new Date('2026-05-19T00:00:00Z'),
	updatedAt: new Date('2026-05-19T00:00:00Z'),
}
const repositoryImportOutput: GitHubRepositoryImport = {
	id: repositoryImportId,
	repositoryId: undefined,
	provider: 'github',
	targetName: repository.name,
	targetSlug: 'tessera' as RepositorySlug,
	source: {
		githubId: repository.githubId,
		ownerLogin: repository.ownerLogin,
		name: repository.name,
		fullName: repository.fullName,
		visibility: repository.visibility,
		defaultBranch: repository.defaultBranch,
		githubUrl: repository.githubUrl,
	},
	status: 'pending',
	failureReason: undefined,
	startedAt: undefined,
	completedAt: undefined,
	createdAt: repositoryImport.createdAt,
	updatedAt: repositoryImport.updatedAt,
}

describe(GitHubImportService.name, () => {
	let moduleRef: TestingModule
	let githubImportService: GitHubImportService
	let githubImportRepository: GitHubImportRepository
	let githubOctokitClient: GitHubOctokitClient
	let githubImportQueue: GitHubImportQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubImportService,
				{
					provide: GitHubImportRepository,
					useValue: {
						findGitHubAccount: vi.fn(),
						hasActiveSource: vi.fn(),
						hasRepositoryTargetSlug: vi.fn(),
						hasActiveTargetSlug: vi.fn(),
						createImport: vi.fn(),
						listImports: vi.fn(),
						findImport: vi.fn(),
						markFailed: vi.fn(),
					},
				},
				{
					provide: GitHubOctokitClient,
					useValue: {
						listRepositories: vi.fn(),
						getRepository: vi.fn(),
					},
				},
				{
					provide: GitHubImportQueue,
					useValue: {
						enqueueRepositoryImport: vi.fn(),
					},
				},
			],
		}).compile()

		githubImportService = moduleRef.get(GitHubImportService)
		githubImportRepository = moduleRef.get(GitHubImportRepository)
		githubOctokitClient = moduleRef.get(GitHubOctokitClient)
		githubImportQueue = moduleRef.get(GitHubImportQueue)
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

	test('rejects repository listing when the GitHub token lacks repo scope', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'read:user user:email',
			accessTokenExpiresAt: null,
		})

		await expect(
			githubImportService.listRepositories(mockUserId)
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
		expect(githubOctokitClient.listRepositories).not.toHaveBeenCalled()
	})

	test('creates an import from GitHub metadata and enqueues it', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		const getRepositorySpy = vi
			.spyOn(githubOctokitClient, 'getRepository')
			.mockResolvedValue(repository)
		vi.spyOn(githubImportRepository, 'hasActiveSource').mockResolvedValue(false)
		vi.spyOn(
			githubImportRepository,
			'hasRepositoryTargetSlug'
		).mockResolvedValue(false)
		vi.spyOn(githubImportRepository, 'hasActiveTargetSlug').mockResolvedValue(
			false
		)
		const createImportSpy = vi
			.spyOn(githubImportRepository, 'createImport')
			.mockResolvedValue(repositoryImport)
		const enqueueRepositoryImportSpy = vi.spyOn(
			githubImportQueue,
			'enqueueRepositoryImport'
		)

		expect(
			await githubImportService.createImport(mockUserId, { githubId: '123' })
		).toEqual(repositoryImportOutput)
		expect(getRepositorySpy).toHaveBeenCalledWith({
			accessToken: 'github-token',
			githubId: '123',
		})
		expect(createImportSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			targetSlug: 'tessera',
			repository,
		})
		expect(enqueueRepositoryImportSpy).toHaveBeenCalledWith(repositoryImportId)
	})

	test('rejects import creation when the GitHub token lacks repo scope', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'read:user',
			accessTokenExpiresAt: null,
		})

		await expect(
			githubImportService.createImport(mockUserId, { githubId: '123' })
		).rejects.toBeInstanceOf(GitHubImportAuthenticationError)
		expect(githubOctokitClient.getRepository).not.toHaveBeenCalled()
	})

	test('marks an import failed when enqueue fails', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubOctokitClient, 'getRepository').mockResolvedValue(repository)
		vi.spyOn(githubImportRepository, 'hasActiveSource').mockResolvedValue(false)
		vi.spyOn(
			githubImportRepository,
			'hasRepositoryTargetSlug'
		).mockResolvedValue(false)
		vi.spyOn(githubImportRepository, 'hasActiveTargetSlug').mockResolvedValue(
			false
		)
		vi.spyOn(githubImportRepository, 'createImport').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportQueue, 'enqueueRepositoryImport').mockRejectedValue(
			new Error('redis unavailable')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')

		await expect(
			githubImportService.createImport(mockUserId, { githubId: '123' })
		).rejects.toThrow('redis unavailable')
		expect(markFailedSpy).toHaveBeenCalledWith({
			importId: repositoryImportId,
			failureReason: 'redis unavailable',
		})
	})

	test('rejects create when the source already has an active import', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubOctokitClient, 'getRepository').mockResolvedValue(repository)
		vi.spyOn(githubImportRepository, 'hasActiveSource').mockResolvedValue(true)
		vi.spyOn(
			githubImportRepository,
			'hasRepositoryTargetSlug'
		).mockResolvedValue(false)
		vi.spyOn(githubImportRepository, 'hasActiveTargetSlug').mockResolvedValue(
			false
		)

		await expect(
			githubImportService.createImport(mockUserId, { githubId: '123' })
		).rejects.toBeInstanceOf(GitHubImportDuplicateActiveSourceError)
		expect(githubImportRepository.createImport).not.toHaveBeenCalled()
	})

	test('rejects create when target slug is already unavailable', async () => {
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubOctokitClient, 'getRepository').mockResolvedValue(repository)
		vi.spyOn(githubImportRepository, 'hasActiveSource').mockResolvedValue(false)
		vi.spyOn(
			githubImportRepository,
			'hasRepositoryTargetSlug'
		).mockResolvedValue(true)
		vi.spyOn(githubImportRepository, 'hasActiveTargetSlug').mockResolvedValue(
			false
		)

		await expect(
			githubImportService.createImport(mockUserId, { githubId: '123' })
		).rejects.toBeInstanceOf(GitHubImportTargetSlugUnavailableError)
		expect(githubImportRepository.createImport).not.toHaveBeenCalled()
	})
})
