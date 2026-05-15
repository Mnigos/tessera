import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, eq, repositories } from '@repo/db'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { RepositoryCreateFailedError } from '../domain/repository.errors'
import { RepositoriesRepository } from './repositories.repository'

describe(RepositoriesRepository.name, () => {
	let moduleRef: TestingModule
	let repositoriesRepository: RepositoriesRepository

	const findManyMock = vi.fn()
	const findFirstRepositoryMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	const deleteMock = vi.fn()
	const selectMock = vi.fn()
	const fromMock = vi.fn()
	const innerJoinMock = vi.fn()
	const selectWhereMock = vi.fn()
	const limitMock = vi.fn()
	const valuesMock = vi.fn()
	const setMock = vi.fn()
	const whereMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const returningMock = vi.fn()
	const updateReturningMock = vi.fn()

	beforeEach(async () => {
		returningMock.mockResolvedValue([
			{
				id: '00000000-0000-4000-8000-000000000002',
				slug: 'notes',
				name: 'Notes',
			},
		])
		valuesMock.mockReturnValue({ returning: returningMock })
		insertMock.mockReturnValue({ values: valuesMock })
		updateReturningMock.mockResolvedValue([
			{
				id: '00000000-0000-4000-8000-000000000002',
				slug: 'notes',
				name: 'Notes',
				storagePath: '/var/lib/tessera/repositories/repo.git',
			},
		])
		whereMock.mockReturnValue({ returning: updateReturningMock })
		setMock.mockReturnValue({ where: whereMock })
		updateMock.mockReturnValue({ set: setMock })
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		limitMock.mockResolvedValue([
			{
				id: '00000000-0000-4000-8000-000000000002',
				slug: 'notes',
				name: 'Notes',
				description: null,
				visibility: 'public',
				ownerUserId: mockUserId,
				ownerOrganizationId: null,
				defaultBranch: 'main',
				storagePath: '/var/lib/tessera/repositories/repo.git',
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
				ownerUsername: 'marta',
			},
		])
		selectWhereMock.mockReturnValue({ limit: limitMock })
		innerJoinMock.mockReturnValue({ where: selectWhereMock })
		fromMock.mockReturnValue({ innerJoin: innerJoinMock })
		selectMock.mockReturnValue({ from: fromMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoriesRepository,
				{
					provide: Database,
					useValue: {
						query: {
							repositories: {
								findMany: findManyMock,
								findFirst: findFirstRepositoryMock,
							},
						},
						insert: insertMock,
						update: updateMock,
						delete: deleteMock,
						select: selectMock,
					},
				},
			],
		}).compile()

		repositoriesRepository = moduleRef.get(RepositoriesRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists user-owned repositories', async () => {
		findManyMock.mockResolvedValue([
			{ slug: 'notes', ownerUser: { username: 'marta' } },
		])

		expect(await repositoriesRepository.list({ userId: mockUserId })).toEqual([
			{ slug: 'notes', ownerUser: { username: 'marta' } },
		])
		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: eq(repositories.ownerUserId, mockUserId),
			})
		)
	})

	test('filters repository rows without owner usernames from list output', async () => {
		findManyMock.mockResolvedValue([
			{ slug: 'notes', ownerUser: { username: 'marta' } },
			{ slug: 'missing-owner', ownerUser: null },
		])

		expect(await repositoriesRepository.list({ userId: mockUserId })).toEqual([
			{ slug: 'notes', ownerUser: { username: 'marta' } },
		])
	})

	test('creates a repository from the insert returning row', async () => {
		expect(
			await repositoriesRepository.create({
				userId: mockUserId,
				name: 'Notes' as RepositoryName,
				slug: 'notes' as RepositorySlug,
				username: 'marta',
			})
		).toEqual({
			id: '00000000-0000-4000-8000-000000000002',
			slug: 'notes',
			name: 'Notes',
			ownerUser: { username: 'marta' },
		})
		expect(insertMock).toHaveBeenCalledWith(repositories)
		expect(valuesMock).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			name: 'Notes',
			slug: 'notes',
			description: undefined,
			visibility: undefined,
		})
		expect(returningMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: repositories.id,
				name: repositories.name,
				slug: repositories.slug,
				defaultBranch: repositories.defaultBranch,
			})
		)
		expect(findFirstRepositoryMock).not.toHaveBeenCalled()
	})

	test('finds a repository by owner username and slug', async () => {
		expect(
			await repositoriesRepository.find({
				username: 'marta',
				slug: 'notes' as RepositorySlug,
			})
		).toEqual({
			id: '00000000-0000-4000-8000-000000000002',
			slug: 'notes',
			name: 'Notes',
			description: null,
			visibility: 'public',
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			defaultBranch: 'main',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			createdAt: new Date('2026-05-12T00:00:00Z'),
			updatedAt: new Date('2026-05-12T00:00:00Z'),
			ownerUser: { username: 'marta' },
		})
		expect(selectMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: repositories.id,
				storagePath: repositories.storagePath,
			})
		)
		expect(fromMock).toHaveBeenCalledWith(repositories)
		expect(limitMock).toHaveBeenCalledWith(1)
	})

	test('finds a repository by owner user id and slug', async () => {
		findFirstRepositoryMock.mockResolvedValue({
			id: '00000000-0000-4000-8000-000000000002',
			slug: 'notes',
			name: 'Notes',
			ownerUser: { username: 'marta' },
		})

		expect(
			await repositoriesRepository.find({
				userId: mockUserId,
				slug: 'notes' as RepositorySlug,
			})
		).toEqual({
			id: '00000000-0000-4000-8000-000000000002',
			slug: 'notes',
			name: 'Notes',
			ownerUser: { username: 'marta' },
		})
		expect(findFirstRepositoryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: and(
					eq(repositories.ownerUserId, mockUserId),
					eq(repositories.slug, 'notes' as RepositorySlug)
				),
				with: {
					ownerUser: { columns: { username: true } },
				},
			})
		)
	})

	test('returns undefined when owner username and slug lookup misses', async () => {
		limitMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.find({
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).toBeUndefined()
	})

	test('returns undefined when owner user id lookup has no owner username', async () => {
		findFirstRepositoryMock.mockResolvedValue({
			id: '00000000-0000-4000-8000-000000000002',
			slug: 'notes',
			name: 'Notes',
			ownerUser: null,
		})

		expect(
			await repositoriesRepository.find({
				userId: mockUserId,
				slug: 'notes' as RepositorySlug,
			})
		).toBeUndefined()
	})

	test('throws a domain error when insert returning is empty', async () => {
		returningMock.mockResolvedValue([])

		await expect(
			repositoriesRepository.create({
				userId: mockUserId,
				name: 'Notes' as RepositoryName,
				slug: 'notes' as RepositorySlug,
				username: 'marta',
			})
		).rejects.toBeInstanceOf(RepositoryCreateFailedError)
	})

	test('persists storage path for a created repository', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

		expect(
			await repositoriesRepository.updateStoragePath({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				username: 'marta',
			})
		).toEqual({
			id: repositoryId,
			slug: 'notes',
			name: 'Notes',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ownerUser: { username: 'marta' },
		})
		expect(updateMock).toHaveBeenCalledWith(repositories)
		expect(setMock).toHaveBeenCalledWith({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(whereMock).toHaveBeenCalledWith(eq(repositories.id, repositoryId))
		expect(updateReturningMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: repositories.id,
				storagePath: repositories.storagePath,
			})
		)
	})

	test('returns undefined when storage path update finds no repository', async () => {
		updateReturningMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.updateStoragePath({
				repositoryId: '00000000-0000-4000-8000-000000000404' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/missing.git',
				username: 'marta',
			})
		).toBeUndefined()
	})

	test('deletes a repository by id for cleanup', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

		await repositoriesRepository.delete({ repositoryId })

		expect(deleteMock).toHaveBeenCalledWith(repositories)
		expect(deleteWhereMock).toHaveBeenCalledWith(
			eq(repositories.id, repositoryId)
		)
	})
})
