import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq, repositories } from '@repo/db'
import type { RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { RepositoryCreateFailedError } from '../domain/repository.errors'
import { RepositoriesRepository } from './repositories.repository'

describe(RepositoriesRepository.name, () => {
	let moduleRef: TestingModule
	let repositoriesRepository: RepositoriesRepository

	const findManyMock = vi.fn()
	const findFirstRepositoryMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const returningMock = vi.fn()

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
})
