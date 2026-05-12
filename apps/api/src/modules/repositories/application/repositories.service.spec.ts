import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { RepositoryWithOwner } from '../domain/repository'
import {
	DuplicateRepositorySlugError,
	RepositoryNotFoundError,
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
						findOwned: vi.fn(),
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
				storagePath: undefined,
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
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('lists repositories for the authenticated username', async () => {
		const listSpy = vi
			.spyOn(repositoriesRepository, 'list')
			.mockResolvedValue([repository])

		expect(await repositoriesService.list(mockUserId)).toEqual({
			repositories: [
				expect.objectContaining({
					repository: expect.objectContaining({ slug: repository.slug }),
				}),
			],
		})
		expect(listSpy).toHaveBeenCalledWith({ userId: mockUserId })
	})

	test('gets an owned repository by username and repository slug', async () => {
		const findOwnedSpy = vi
			.spyOn(repositoriesRepository, 'findOwned')
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
		expect(findOwnedSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			slug: repository.slug,
		})
	})

	test('throws when an owned repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'findOwned').mockResolvedValue(undefined)

		await expect(
			repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})
})
