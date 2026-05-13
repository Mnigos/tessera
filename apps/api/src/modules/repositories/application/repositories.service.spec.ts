import { GitStorageClient } from '@config/git-storage'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { RepositoryWithOwner } from '../domain/repository'
import {
	DuplicateRepositorySlugError,
	PrivateRepositoryGitReadForbiddenError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryNotFoundError,
	RepositoryStoragePathMissingError,
} from '../domain/repository.errors'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import { RepositoriesService } from './repositories.service'

const repository: RepositoryWithOwner = {
	id: '00000000-0000-4000-8000-000000000003' as RepositoryId,
	ownerUserId: mockUserId,
	ownerOrganizationId: null,
	ownerUser: { username: 'marta' },
	slug: 'tessera-notes' as RepositorySlug,
	name: 'Tessera Notes' as RepositoryName,
	description: 'Notes',
	visibility: 'private',
	defaultBranch: 'main',
	storagePath: null,
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

describe(RepositoriesService.name, () => {
	let moduleRef: TestingModule
	let repositoriesService: RepositoriesService
	let repositoriesRepository: RepositoriesRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoriesService,
				{
					provide: RepositoriesRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						find: vi.fn(),
						updateStoragePath: vi.fn(),
						delete: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						createRepository: vi.fn().mockResolvedValue({
							storagePath: '/var/lib/tessera/repositories/repo.git',
						}),
					},
				},
			],
		}).compile()

		repositoriesService = moduleRef.get(RepositoriesService)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a user-owned repository with a generated slug', async () => {
		const createSpy = vi
			.spyOn(repositoriesRepository, 'create')
			.mockResolvedValue(repository)
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const createRepositorySpy = vi.spyOn(gitStorageClient, 'createRepository')
		const updateStoragePathSpy = vi
			.spyOn(repositoriesRepository, 'updateStoragePath')
			.mockResolvedValue({
				...repository,
				storagePath: '/var/lib/tessera/repositories/repo.git',
			})

		expect(
			await repositoriesService.create(mockUserId, 'marta', {
				name: ' Tessera Notes ',
			})
		).toEqual({
			repository: {
				id: repository.id,
				slug: repository.slug,
				name: repository.name,
				visibility: 'private',
				description: 'Notes',
				defaultBranch: 'main',
				createdAt: repository.createdAt,
				updatedAt: repository.updatedAt,
			},
			owner: {
				username: 'marta',
			},
		})
		expect(createSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			name: 'Tessera Notes',
			slug: 'tessera-notes',
			username: 'marta',
			description: undefined,
			visibility: undefined,
		})
		expect(createRepositorySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
		})
		expect(updateStoragePathSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			username: 'marta',
		})
	})

	test('cleans up metadata when git storage creation fails', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'createRepository'
		).mockRejectedValue(new Error('git storage failed'))
		const deleteSpy = vi.spyOn(repositoriesRepository, 'delete')

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toThrow('git storage failed')
		expect(deleteSpy).toHaveBeenCalledWith({ repositoryId: repository.id })
	})

	test('cleans up metadata when storage path persistence fails', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'updateStoragePath').mockResolvedValue(
			undefined
		)
		const deleteSpy = vi.spyOn(repositoriesRepository, 'delete')

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryCreateFailedError)
		expect(deleteSpy).toHaveBeenCalledWith({ repositoryId: repository.id })
	})

	test('maps duplicate owner slug database errors to a conflict', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'repositories_owner_user_slug_unique',
		})

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(DuplicateRepositorySlugError)
	})

	test('maps wrapped duplicate owner slug database errors to a conflict', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue({
			cause: {
				code: '23505',
				constraint_name: 'repositories_owner_user_slug_unique',
			},
		})

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(DuplicateRepositorySlugError)
	})

	test('rejects create requests when the session has no username', async () => {
		await expect(
			repositoriesService.create(mockUserId, undefined, {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryCreatorUsernameRequiredError)
	})

	test('lists repositories for the authenticated username', async () => {
		const listSpy = vi
			.spyOn(repositoriesRepository, 'list')
			.mockResolvedValue([repository])

		expect(await repositoriesService.list(mockUserId)).toEqual([
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({ userId: mockUserId })
	})

	test('gets an owned repository by username and repository slug', async () => {
		const findSpy = vi
			.spyOn(repositoriesRepository, 'find')
			.mockResolvedValue(repository)

		expect(
			await repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
			})
		)
		expect(findSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			slug: repository.slug,
		})
	})

	test('throws when an owned repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('authorizes git reads for public repositories with storage metadata', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(findSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: repository.slug,
		})
	})

	test('throws when a git read repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('forbids git reads for private repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(repository)

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(PrivateRepositoryGitReadForbiddenError)
	})

	test('throws when a public git read repository has no storage path', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: null,
		})

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
	})
})
