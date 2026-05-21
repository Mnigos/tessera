import { GitStorageClient } from '@config/git-storage'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryImportId } from '@repo/db'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import type { Job } from 'bullmq'
import { ServiceUnavailableError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import { RepositoriesService } from '../../repositories/application/repositories.service'
import { DuplicateRepositorySlugError } from '../../repositories/domain/repository.errors'
import type { GitHubImportRepositoryJobData } from '../infrastructure/github-import.queue'
import { GitHubImportRepository } from '../infrastructure/github-import.repository'
import { GitHubImportProcessor } from './github-import.processor'

const importId = '00000000-0000-4000-8000-000000000029' as RepositoryImportId
const repositoryId = '00000000-0000-4000-8000-000000000030' as RepositoryId
const repositoryImport = {
	id: importId,
	ownerUserId: mockUserId,
	repositoryId: null,
	provider: 'github' as const,
	targetName: 'tessera',
	targetSlug: 'tessera' as RepositorySlug,
	sourceGithubId: 123n,
	sourceOwnerLogin: 'marta',
	sourceName: 'tessera',
	sourceFullName: 'marta/tessera',
	sourceVisibility: 'private' as const,
	sourceDefaultBranch: 'main',
	sourceGithubUrl: 'https://github.com/marta/tessera',
	status: 'running' as const,
	failureReason: null,
	startedAt: new Date('2026-05-19T00:00:00Z'),
	completedAt: null,
	createdAt: new Date('2026-05-19T00:00:00Z'),
	updatedAt: new Date('2026-05-19T00:00:00Z'),
}
const job = {
	attemptsMade: 0,
	data: { importId },
	opts: { attempts: 1 },
} as Job<GitHubImportRepositoryJobData>

describe(GitHubImportProcessor.name, () => {
	let moduleRef: TestingModule
	let processor: GitHubImportProcessor
	let githubImportRepository: GitHubImportRepository
	let repositoriesService: RepositoriesService
	let gitStorageClient: GitStorageClient & {
		createRepository: ReturnType<typeof vi.fn>
		importRepository: ReturnType<typeof vi.fn>
	}

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubImportProcessor,
				{
					provide: GitHubImportRepository,
					useValue: {
						markRunning: vi.fn(),
						findGitHubAccount: vi.fn(),
						findOwnerUsername: vi.fn(),
						markRepositoryMetadata: vi.fn(),
						markSucceeded: vi.fn(),
						markFailed: vi.fn(),
					},
				},
				{
					provide: RepositoriesService,
					useValue: {
						createImportedRepositoryMetadata: vi.fn(),
						updateImportedRepositoryStorage: vi.fn(),
						deleteRepositoryMetadata: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						createRepository: vi.fn(),
						importRepository: vi.fn(),
					},
				},
			],
		}).compile()

		processor = moduleRef.get(GitHubImportProcessor)
		githubImportRepository = moduleRef.get(GitHubImportRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		gitStorageClient = moduleRef.get(GitStorageClient)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	test('imports a repository and marks the import succeeded', async () => {
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		const createImportedRepositoryMetadataSpy = vi
			.spyOn(repositoriesService, 'createImportedRepositoryMetadata')
			.mockResolvedValue({
				id: repositoryId,
				name: 'tessera' as RepositoryName,
				slug: 'tessera' as RepositorySlug,
				description: null,
				visibility: 'private',
				ownerUserId: mockUserId,
				ownerOrganizationId: null,
				defaultBranch: 'main',
				storagePath: null,
				createdAt: repositoryImport.createdAt,
				updatedAt: repositoryImport.updatedAt,
				ownerUser: { username: 'marta' },
			})
		const importRepositorySpy = vi
			.spyOn(gitStorageClient, 'importRepository')
			.mockResolvedValue({
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'trunk',
			})
		const createRepositorySpy = vi
			.spyOn(gitStorageClient, 'createRepository')
			.mockResolvedValue({
				storagePath: '/var/lib/tessera/repositories/repo.git',
			})
		const updateImportedRepositoryStorageSpy = vi
			.spyOn(repositoriesService, 'updateImportedRepositoryStorage')
			.mockResolvedValue({
				id: repositoryId,
				name: 'tessera' as RepositoryName,
				slug: 'tessera' as RepositorySlug,
				description: null,
				visibility: 'private',
				ownerUserId: mockUserId,
				ownerOrganizationId: null,
				defaultBranch: 'trunk',
				storagePath: '/var/lib/tessera/repositories/repo.git',
				createdAt: repositoryImport.createdAt,
				updatedAt: repositoryImport.updatedAt,
				ownerUser: { username: 'marta' },
			})
		const markSucceededSpy = vi.spyOn(githubImportRepository, 'markSucceeded')
		const markRepositoryMetadataSpy = vi.spyOn(
			githubImportRepository,
			'markRepositoryMetadata'
		)

		await processor.process(job)

		expect(createImportedRepositoryMetadataSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			username: 'marta',
			name: 'tessera',
			slug: 'tessera',
			visibility: 'private',
		})
		expect(markRepositoryMetadataSpy).toHaveBeenCalledWith({
			importId,
			repositoryId,
		})
		expect(createRepositorySpy).toHaveBeenCalledWith({ repositoryId })
		expect(importRepositorySpy).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			sourceUrl: 'https://github.com/marta/tessera',
			accessToken: 'github-token',
			defaultBranchHint: 'main',
		})
		expect(updateImportedRepositoryStorageSpy).toHaveBeenCalledWith({
			repositoryId,
			username: 'marta',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
		})
		expect(markSucceededSpy).toHaveBeenCalledWith({
			importId,
			repositoryId,
		})
	})

	test('reuses repository metadata linked by a previous attempt', async () => {
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue({
			...repositoryImport,
			repositoryId,
		})
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		const createImportedRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		)
		const markRepositoryMetadataSpy = vi.spyOn(
			githubImportRepository,
			'markRepositoryMetadata'
		)
		vi.spyOn(gitStorageClient, 'createRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
		})
		vi.spyOn(
			repositoriesService,
			'updateImportedRepositoryStorage'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'trunk',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})

		await processor.process(job)

		expect(createImportedRepositoryMetadataSpy).not.toHaveBeenCalled()
		expect(markRepositoryMetadataSpy).not.toHaveBeenCalled()
		expect(gitStorageClient.createRepository).toHaveBeenCalledWith({
			repositoryId,
		})
	})

	test('deletes newly created metadata when linking it to the import fails', async () => {
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(
			githubImportRepository,
			'markRepositoryMetadata'
		).mockRejectedValue(new Error('import link failed'))
		const deleteRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'deleteRepositoryMetadata'
		)

		await processor.process(job)

		expect(deleteRepositoryMetadataSpy).toHaveBeenCalledWith(repositoryId)
		expect(gitStorageClient.createRepository).not.toHaveBeenCalled()
	})

	test('marks failed and keeps repository metadata after storage is allocated', async () => {
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockRejectedValue(
			new Error('clone failed')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')
		const deleteRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'deleteRepositoryMetadata'
		)

		await processor.process(job)
		expect(markFailedSpy).toHaveBeenCalledWith({
			importId,
			failureReason: 'clone failed',
		})
		expect(deleteRepositoryMetadataSpy).not.toHaveBeenCalled()
	})

	test('throws without marking failed before storage is allocated on a retryable attempt', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 2 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockRejectedValue(
			new Error('storage unavailable')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')
		const deleteRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'deleteRepositoryMetadata'
		)

		await expect(processor.process(retryingJob)).rejects.toThrow(
			'storage unavailable'
		)
		expect(markFailedSpy).not.toHaveBeenCalled()
		expect(deleteRepositoryMetadataSpy).toHaveBeenCalledWith(repositoryId)
	})

	test('keeps the penultimate BullMQ attempt retryable', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 8,
			opts: { attempts: 10 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockRejectedValue(
			new Error('storage unavailable')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')

		await expect(processor.process(retryingJob)).rejects.toThrow(
			'storage unavailable'
		)
		expect(markFailedSpy).not.toHaveBeenCalled()
	})

	test('marks failed without retrying after storage is allocated', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 2 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockRejectedValue(
			new Error('clone failed')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')
		const deleteRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'deleteRepositoryMetadata'
		)

		await processor.process(retryingJob)

		expect(markFailedSpy).toHaveBeenCalledWith({
			importId,
			failureReason: 'clone failed',
		})
		expect(deleteRepositoryMetadataSpy).not.toHaveBeenCalled()
	})

	test('keeps repository metadata when import status update fails after storage is persisted', async () => {
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
		})
		vi.spyOn(
			repositoriesService,
			'updateImportedRepositoryStorage'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'trunk',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(githubImportRepository, 'markSucceeded').mockRejectedValue(
			new Error('status update failed')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')
		const deleteRepositoryMetadataSpy = vi.spyOn(
			repositoriesService,
			'deleteRepositoryMetadata'
		)

		await processor.process(job)

		expect(markFailedSpy).toHaveBeenCalledWith({
			importId,
			failureReason: 'status update failed',
		})
		expect(deleteRepositoryMetadataSpy).not.toHaveBeenCalled()
	})

	test('does not log retry intent for unavailable storage after storage is allocated', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 2 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockResolvedValue({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockRejectedValue(
			new ServiceUnavailableError('git storage')
		)
		const warnSpy = vi
			.spyOn(Logger.prototype, 'warn')
			.mockImplementation(() => undefined)
		const errorSpy = vi
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined)

		await processor.process(retryingJob)

		expect(warnSpy).not.toHaveBeenCalledWith(
			'GitHub repository import dependency unavailable; retrying'
		)
		expect(errorSpy).toHaveBeenCalledWith(
			'GitHub repository import failed',
			expect.any(String)
		)
	})

	test('warns without marking failed when git storage is temporarily unavailable', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 2 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockResolvedValue({
			id: repositoryId,
			name: 'tessera' as RepositoryName,
			slug: 'tessera' as RepositorySlug,
			description: null,
			visibility: 'private',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: null,
			createdAt: repositoryImport.createdAt,
			updatedAt: repositoryImport.updatedAt,
			ownerUser: { username: 'marta' },
		})
		vi.spyOn(gitStorageClient, 'createRepository').mockRejectedValue(
			new ServiceUnavailableError('git storage')
		)
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')

		await expect(processor.process(retryingJob)).rejects.toBeInstanceOf(
			ServiceUnavailableError
		)
		expect(markFailedSpy).not.toHaveBeenCalled()
	})

	test('marks failed without retrying when imported repository slug already exists', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 10 },
		} as Job<GitHubImportRepositoryJobData>
		vi.spyOn(githubImportRepository, 'markRunning').mockResolvedValue(
			repositoryImport
		)
		vi.spyOn(githubImportRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(githubImportRepository, 'findOwnerUsername').mockResolvedValue(
			'marta'
		)
		vi.spyOn(
			repositoriesService,
			'createImportedRepositoryMetadata'
		).mockRejectedValue(new DuplicateRepositorySlugError('tessera'))
		const markFailedSpy = vi.spyOn(githubImportRepository, 'markFailed')

		await processor.process(retryingJob)

		expect(markFailedSpy).toHaveBeenCalledWith({
			importId,
			failureReason: 'repository slug already exists',
		})
		expect(gitStorageClient.createRepository).not.toHaveBeenCalled()
	})
})
