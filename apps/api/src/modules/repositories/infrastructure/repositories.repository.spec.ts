import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	and,
	eq,
	isNotNull,
	repositories,
	repositoryExternalSources,
} from '@repo/db'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { RepositoryCreateFailedError } from '../domain/repository.errors'
import { RepositoriesRepository } from './repositories.repository'

const repositoryRow = {
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
	externalSource: null,
}

describe(RepositoriesRepository.name, () => {
	let moduleRef: TestingModule
	let repositoriesRepository: RepositoriesRepository

	const findManyMock = vi.fn()
	const findFirstRepositoryMock = vi.fn()
	const findFirstAccountMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	const deleteMock = vi.fn()
	const selectMock = vi.fn()
	const fromMock = vi.fn()
	const innerJoinMock = vi.fn()
	const leftJoinMock = vi.fn()
	const selectWhereMock = vi.fn()
	const limitMock = vi.fn()
	const orderByMock = vi.fn()
	const valuesMock = vi.fn()
	const onConflictDoUpdateMock = vi.fn()
	const setMock = vi.fn()
	const whereMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const returningMock = vi.fn()
	const updateReturningMock = vi.fn()
	const transactionMock = vi.fn()
	const withBuilderMock = vi.fn()
	const withAsMock = vi.fn()
	const withMock = vi.fn()

	beforeEach(async () => {
		const databaseMock = {
			query: {
				account: {
					findFirst: findFirstAccountMock,
				},
				repositories: {
					findMany: findManyMock,
					findFirst: findFirstRepositoryMock,
				},
			},
			insert: insertMock,
			update: updateMock,
			delete: deleteMock,
			select: selectMock,
			$with: withBuilderMock,
			with: withMock,
			transaction: transactionMock,
		}

		transactionMock.mockImplementation(async callback => callback(databaseMock))
		withBuilderMock.mockReturnValue({ as: withAsMock })
		returningMock.mockResolvedValue([
			{
				id: '00000000-0000-4000-8000-000000000002',
				slug: 'notes',
				name: 'Notes',
			},
		])
		valuesMock.mockReturnValue({
			returning: returningMock,
			onConflictDoUpdate: onConflictDoUpdateMock,
		})
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
		limitMock.mockResolvedValue([repositoryRow])
		orderByMock.mockResolvedValue([repositoryRow])
		selectWhereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
		leftJoinMock.mockReturnValue({ where: selectWhereMock })
		innerJoinMock.mockReturnValue({
			leftJoin: leftJoinMock,
			innerJoin: innerJoinMock,
			where: selectWhereMock,
		})
		fromMock.mockReturnValue({ innerJoin: innerJoinMock })
		selectMock.mockReturnValue({ from: fromMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoriesRepository,
				{
					provide: Database,
					useValue: databaseMock,
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
		expect(await repositoriesRepository.list({ userId: mockUserId })).toEqual([
			expect.objectContaining({
				slug: 'notes',
				ownerUser: { username: 'marta' },
			}),
		])
		expect(leftJoinMock).toHaveBeenCalledWith(
			repositoryExternalSources,
			eq(repositoryExternalSources.repositoryId, repositories.id)
		)
		expect(selectWhereMock).toHaveBeenCalledWith(
			and(
				eq(repositories.ownerUserId, mockUserId),
				isNotNull(repositories.storagePath)
			)
		)
	})

	test('filters repository rows without owner usernames from list output', async () => {
		orderByMock.mockResolvedValue([
			repositoryRow,
			{
				...repositoryRow,
				id: '00000000-0000-4000-8000-000000000003',
				slug: 'missing-owner',
				ownerUsername: null,
			},
		])

		expect(await repositoriesRepository.list({ userId: mockUserId })).toEqual([
			expect.objectContaining({
				slug: 'notes',
				ownerUser: { username: 'marta' },
			}),
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
			externalSource: undefined,
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
		expect(
			await repositoriesRepository.find({
				userId: mockUserId,
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
			externalSource: undefined,
		})
		expect(selectWhereMock).toHaveBeenCalledWith(
			and(
				eq(repositories.ownerUserId, mockUserId),
				eq(repositories.slug, 'notes' as RepositorySlug)
			)
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
		limitMock.mockResolvedValue([{ ...repositoryRow, ownerUsername: null }])

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

	test('upserts GitHub external source metadata', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const completedAt = new Date('2026-05-12T00:01:00Z')

		await repositoriesRepository.upsertGitHubExternalSource({
			repositoryId,
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncSucceededAt: completedAt,
		})

		expect(insertMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(valuesMock).toHaveBeenCalledWith({
			repositoryId,
			provider: 'github',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: undefined,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			nextSyncAt: undefined,
			syncFailureCount: undefined,
			syncFailureReason: undefined,
		})
		expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
			target: repositoryExternalSources.repositoryId,
			set: expect.objectContaining({
				mirrorMode: 'imported',
				syncStatus: 'succeeded',
			}),
		})
	})

	test('upserts GitHub mirror scheduling metadata', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const completedAt = new Date('2026-05-12T00:01:00Z')
		const nextSyncAt = new Date('2026-05-12T00:16:00Z')

		await repositoriesRepository.upsertGitHubExternalSource({
			repositoryId,
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncSucceededAt: completedAt,
			nextSyncAt,
			syncFailureCount: 2,
		})

		expect(valuesMock).toHaveBeenCalledWith({
			repositoryId,
			provider: 'github',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncStartedAt: undefined,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			nextSyncAt,
			syncFailureCount: 2,
			syncFailureReason: undefined,
		})
		expect(onConflictDoUpdateMock).toHaveBeenCalledWith({
			target: repositoryExternalSources.repositoryId,
			set: expect.objectContaining({
				nextSyncAt,
				syncFailureCount: 2,
			}),
		})
	})

	test('completes imported GitHub repository storage and external source metadata in one transaction', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const completedAt = new Date('2026-05-12T00:01:00Z')

		expect(
			await repositoriesRepository.completeImportedGitHubRepository({
				repositoryId,
				username: 'marta',
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'trunk',
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'imported',
				syncStatus: 'succeeded',
				lastSyncSucceededAt: completedAt,
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				slug: 'notes',
				ownerUser: { username: 'marta' },
			})
		)
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenCalledWith(repositories)
		expect(insertMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(updateMock.mock.invocationCallOrder[0]).toBeLessThan(
			insertMock.mock.invocationCallOrder[0] ?? 0
		)
		expect(valuesMock).toHaveBeenCalledWith({
			repositoryId,
			provider: 'github',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: undefined,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			nextSyncAt: undefined,
			syncFailureCount: undefined,
			syncFailureReason: undefined,
		})
	})

	test('finds GitHub account credentials for a user', async () => {
		findFirstAccountMock.mockResolvedValue({ accessToken: 'github-token' })

		expect(
			await repositoriesRepository.findGitHubAccount({ userId: mockUserId })
		).toEqual({ accessToken: 'github-token' })
	})

	test('marks GitHub mirror sync pending and returns refreshed repository', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

		expect(
			await repositoriesRepository.markGitHubMirrorSyncPending({
				repositoryId,
				userId: mockUserId,
			})
		).toEqual({
			didMarkPending: true,
			repository: expect.objectContaining({
				id: repositoryId,
				ownerUser: { username: 'marta' },
			}),
		})
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith({
			mirrorMode: 'github_to_tessera',
			syncStatus: 'pending',
			lastSyncStartedAt: null,
			lastSyncFailedAt: null,
			nextSyncAt: null,
			syncFailureCount: 0,
			syncFailureReason: null,
		})
		expect(updateReturningMock).toHaveBeenCalledWith({
			id: repositoryExternalSources.id,
		})
	})

	test('marks GitHub mirror sync running before processing', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		limitMock.mockResolvedValue([
			{
				...repositoryRow,
				externalSource: {
					id: '00000000-0000-4000-8000-000000000092',
					repositoryId,
					provider: 'github',
					externalRepositoryId: 123n,
					ownerLogin: 'marta',
					name: 'notes',
					fullName: 'marta/notes',
					sourceUrl: 'https://github.com/marta/notes',
					sourceDefaultBranch: 'main',
					mirrorMode: 'github_to_tessera',
					syncStatus: 'running',
					lastSyncStartedAt: null,
					lastSyncSucceededAt: null,
					lastSyncFailedAt: null,
					nextSyncAt: null,
					syncFailureCount: 0,
					syncFailureReason: null,
					createdAt: new Date('2026-05-12T00:00:00Z'),
					updatedAt: new Date('2026-05-12T00:00:00Z'),
				},
			},
		])

		expect(
			await repositoriesRepository.markGitHubMirrorSyncRunning({
				repositoryId,
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ownerUser: { username: 'marta' },
			})
		)
		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith({
			syncStatus: 'running',
			lastSyncStartedAt: expect.any(Date),
			lastSyncFailedAt: null,
			syncFailureReason: null,
		})
	})

	test('marks GitHub mirror sync succeeded with mirror mode preserved', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const completedAt = new Date('2026-05-12T00:01:00Z')

		expect(
			await repositoriesRepository.markGitHubMirrorSyncSucceeded({
				repositoryId,
				username: 'marta',
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'trunk',
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'github_to_tessera',
				syncStatus: 'succeeded',
				lastSyncSucceededAt: completedAt,
				lastSyncFailedAt: undefined,
				syncFailureReason: undefined,
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				ownerUser: { username: 'marta' },
			})
		)
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(setMock).toHaveBeenCalledWith({
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncStartedAt: undefined,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			nextSyncAt: undefined,
			syncFailureCount: undefined,
			syncFailureReason: undefined,
		})
	})

	test('marks GitHub mirror sync failed with reason', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const failedAt = new Date('2026-05-12T00:01:00Z')

		await repositoriesRepository.markGitHubMirrorSyncFailed({
			repositoryId,
			failedAt,
			failureReason: 'clone failed',
		})

		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith({
			syncStatus: 'failed',
			lastSyncFailedAt: failedAt,
			nextSyncAt: undefined,
			syncFailureCount: undefined,
			syncFailureReason: 'clone failed',
		})
	})

	test('cuts over a GitHub mirror to Tessera source', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const cutoverAt = new Date('2026-05-12T00:02:00Z')

		expect(
			await repositoriesRepository.cutoverGitHubMirror({
				repositoryId,
				userId: mockUserId,
				actorUserId: mockUserId,
				cutoverAt,
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				ownerUser: { username: 'marta' },
			})
		)
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith({
			mirrorMode: 'tessera_source',
			nextSyncAt: null,
			cutoverActorUserId: mockUserId,
			cutoverAt,
			cutoverFromMirrorMode: 'github_to_tessera',
		})
		expect(updateReturningMock).toHaveBeenCalledWith({
			id: repositoryExternalSources.id,
		})
	})

	test('returns undefined when GitHub mirror cutover update is not eligible', async () => {
		updateReturningMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.cutoverGitHubMirror({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				userId: mockUserId,
				actorUserId: mockUserId,
				cutoverAt: new Date('2026-05-12T00:02:00Z'),
			})
		).toBeUndefined()
		expect(limitMock).not.toHaveBeenCalled()
	})

	test('claims due GitHub mirror sync repositories', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const dueForMock = vi.fn()
		const dueLimitMock = vi.fn().mockReturnValue({ for: dueForMock })
		const dueOrderByMock = vi.fn().mockReturnValue({ limit: dueLimitMock })
		const dueWhereMock = vi.fn().mockReturnValue({ orderBy: dueOrderByMock })
		const dueSecondInnerJoinMock = vi
			.fn()
			.mockReturnValue({ where: dueWhereMock })
		const dueFirstInnerJoinMock = vi.fn().mockReturnValue({
			innerJoin: dueSecondInnerJoinMock,
		})
		const dueFromMock = vi.fn().mockReturnValue({
			innerJoin: dueFirstInnerJoinMock,
		})
		const claimReturningMock = vi.fn().mockResolvedValue([{ repositoryId }])
		const claimWhereMock = vi.fn().mockReturnValue({
			returning: claimReturningMock,
		})
		const claimFromMock = vi.fn().mockReturnValue({ where: claimWhereMock })
		const claimSetMock = vi.fn().mockReturnValue({ from: claimFromMock })

		selectMock.mockReturnValueOnce({ from: dueFromMock })
		withAsMock.mockReturnValue({ id: repositoryExternalSources.id })
		withMock.mockReturnValue({
			update: vi.fn().mockReturnValue({ set: claimSetMock }),
		})
		orderByMock.mockResolvedValueOnce([
			{
				...repositoryRow,
				externalSource: {
					id: '00000000-0000-4000-8000-000000000092',
					repositoryId,
					provider: 'github',
					externalRepositoryId: 123n,
					ownerLogin: 'marta',
					name: 'notes',
					fullName: 'marta/notes',
					sourceUrl: 'https://github.com/marta/notes',
					sourceDefaultBranch: 'main',
					mirrorMode: 'github_to_tessera',
					syncStatus: 'pending',
					lastSyncStartedAt: null,
					lastSyncSucceededAt: null,
					lastSyncFailedAt: null,
					nextSyncAt: new Date('2026-05-12T00:00:00Z'),
					syncFailureCount: 0,
					syncFailureReason: null,
					createdAt: new Date('2026-05-12T00:00:00Z'),
					updatedAt: new Date('2026-05-12T00:00:00Z'),
				},
			},
		])

		expect(
			await repositoriesRepository.claimDueGitHubMirrorSyncRepositories({
				limit: 25,
				now: new Date('2026-05-12T00:15:00Z'),
			})
		).toEqual([
			expect.objectContaining({
				id: repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ownerUser: { username: 'marta' },
			}),
		])
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(dueForMock).toHaveBeenCalledWith('update', {
			of: repositoryExternalSources,
			skipLocked: true,
		})
		expect(claimReturningMock).toHaveBeenCalledWith({
			repositoryId: repositoryExternalSources.repositoryId,
		})
	})
})
