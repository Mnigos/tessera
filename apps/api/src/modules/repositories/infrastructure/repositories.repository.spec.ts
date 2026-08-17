import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	member,
	organization,
	repositories,
	repositoryCollaborators,
	repositoryExternalSources,
	sql,
	user,
} from '@repo/db'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
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
	ownerHandle: 'marta',
	externalSource: null,
}

const pgDialect = new PgDialect()

function renderWhereQuery(condition: SQL) {
	return pgDialect.sqlToQuery(condition)
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
	const selectDistinctMock = vi.fn()
	const fromMock = vi.fn()
	const subqueryWhereMock = vi.fn()
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
			selectDistinct: selectDistinctMock,
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
		orderByMock.mockImplementation(() =>
			Object.assign(Promise.resolve([repositoryRow]), { limit: limitMock })
		)
		selectWhereMock.mockReturnValue({ limit: limitMock, orderBy: orderByMock })
		leftJoinMock.mockReturnValue({
			leftJoin: leftJoinMock,
			where: selectWhereMock,
		})
		innerJoinMock.mockReturnValue({
			leftJoin: leftJoinMock,
			innerJoin: innerJoinMock,
			where: selectWhereMock,
		})
		// A `where` straight off `from` skipped the joins; joined queries do not.
		subqueryWhereMock.mockReturnValue({
			userId: 'sub-select',
			limit: limitMock,
		})
		fromMock.mockReturnValue({
			innerJoin: innerJoinMock,
			leftJoin: leftJoinMock,
			where: subqueryWhereMock,
		})
		selectMock.mockReturnValue({ from: fromMock })
		selectDistinctMock.mockReturnValue({ from: fromMock })

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

	test('lists repositories owned by a handle', async () => {
		expect(
			await repositoriesRepository.list({
				ownerUserId: mockUserId,
				ownerOrganizationId: null,
			})
		).toEqual([
			expect.objectContaining({
				slug: 'notes',
				owner: { kind: 'user', handle: 'marta' },
			}),
		])
		expect(leftJoinMock).toHaveBeenCalledWith(
			user,
			eq(repositories.ownerUserId, user.id)
		)
		expect(leftJoinMock).toHaveBeenCalledWith(
			organization,
			eq(repositories.ownerOrganizationId, organization.id)
		)
		expect(leftJoinMock).toHaveBeenCalledWith(
			repositoryExternalSources,
			eq(repositoryExternalSources.repositoryId, repositories.id)
		)
		expect(selectWhereMock).toHaveBeenCalledWith(
			and(
				and(
					eq(repositories.ownerUserId, mockUserId),
					isNull(repositories.ownerOrganizationId)
				),
				isNotNull(repositories.storagePath)
			)
		)
	})

	test('lists repositories owned by an organization identity', async () => {
		const organizationId =
			'00000000-0000-4000-8000-000000000050' as OrganizationId
		orderByMock.mockResolvedValue([
			{
				...repositoryRow,
				ownerUserId: null,
				ownerOrganizationId: organizationId,
				ownerHandle: 'tessera',
			},
		])

		expect(
			await repositoriesRepository.list({
				ownerUserId: null,
				ownerOrganizationId: organizationId,
			})
		).toEqual([
			expect.objectContaining({
				owner: { kind: 'organization', handle: 'tessera' },
			}),
		])
		expect(selectWhereMock).toHaveBeenCalledWith(
			and(
				and(
					isNull(repositories.ownerUserId),
					eq(repositories.ownerOrganizationId, organizationId)
				),
				isNotNull(repositories.storagePath)
			)
		)
	})

	test('filters repository rows without owner handles from list output', async () => {
		orderByMock.mockResolvedValue([
			repositoryRow,
			{
				...repositoryRow,
				id: '00000000-0000-4000-8000-000000000003',
				slug: 'missing-owner',
				ownerHandle: null,
			},
		])

		expect(
			await repositoriesRepository.list({
				ownerUserId: mockUserId,
				ownerOrganizationId: null,
			})
		).toEqual([
			expect.objectContaining({
				slug: 'notes',
				owner: { kind: 'user', handle: 'marta' },
			}),
		])
	})

	test('lists authenticated organization repositories with the complete visibility predicate', async () => {
		const ownerOrganizationId =
			'00000000-0000-4000-8000-000000000010' as OrganizationId
		const memberWhereMock = vi.fn((condition: SQL) => ({
			getSQL: () => sql`select ${member.id} from ${member} where ${condition}`,
		}))
		const collaboratorWhereMock = vi.fn((condition: SQL) => ({
			getSQL: () =>
				sql`select ${repositoryCollaborators.id} from ${repositoryCollaborators} where ${condition}`,
		}))
		const visibleWhereMock = vi.fn((_condition: SQL) => ({
			orderBy: orderByMock,
		}))

		selectMock
			.mockReturnValueOnce({
				from: vi.fn(() => ({ where: memberWhereMock })),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({ where: collaboratorWhereMock })),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({ where: visibleWhereMock })),
			})

		await repositoriesRepository.listVisibleByOwner({
			ownerOrganizationId,
			viewerUserId: mockUserId,
		})

		expect(memberWhereMock).toHaveBeenCalledWith(
			and(
				eq(member.organizationId, repositories.ownerOrganizationId),
				eq(member.userId, mockUserId),
				inArray(member.role, ['owner', 'admin'])
			)
		)
		expect(collaboratorWhereMock).toHaveBeenCalledWith(
			and(
				eq(repositoryCollaborators.repositoryId, repositories.id),
				eq(repositoryCollaborators.userId, mockUserId)
			)
		)
		const condition = visibleWhereMock.mock.calls[0]?.[0]
		if (!condition) throw new Error('Expected visible repository predicate')
		const whereQuery = renderWhereQuery(condition)

		expect(whereQuery.sql).toContain(
			'"repositories"."owner_organization_id" = $1'
		)
		expect(whereQuery.sql).toContain(
			'"repositories"."storage_path" is not null'
		)
		expect(whereQuery.sql).toContain('"repositories"."visibility" = $2')
		expect(whereQuery.sql).toContain('"repositories"."owner_user_id" = $3')
		expect(whereQuery.sql).toContain('exists (select "member"."id"')
		expect(whereQuery.sql).toContain(
			'exists (select "repository_collaborators"."id"'
		)
		expect(whereQuery.params).toEqual(
			expect.arrayContaining([
				ownerOrganizationId,
				'public',
				mockUserId,
				'owner',
				'admin',
			])
		)
		expect(orderByMock).toHaveBeenCalledWith(asc(repositories.createdAt))
	})

	test('limits anonymous user repositories to public stored rows', async () => {
		const visibleWhereMock = vi.fn((_condition: SQL) => ({
			orderBy: orderByMock,
		}))
		selectMock.mockReturnValueOnce({
			from: vi.fn(() => ({ where: visibleWhereMock })),
		})

		await repositoriesRepository.listVisibleByOwner({
			ownerUserId: mockUserId,
		})

		const condition = visibleWhereMock.mock.calls[0]?.[0]
		if (!condition) throw new Error('Expected visible repository predicate')
		const whereQuery = renderWhereQuery(condition)

		expect(whereQuery.sql).toContain('"repositories"."owner_user_id" = $1')
		expect(whereQuery.sql).toContain(
			'"repositories"."storage_path" is not null'
		)
		expect(whereQuery.sql).toContain('"repositories"."visibility" = $2')
		expect(whereQuery.sql).not.toContain('exists')
		expect(whereQuery.params).toEqual([mockUserId, 'public'])
	})

	test('creates a repository and reads its owner handle back', async () => {
		expect(
			await repositoriesRepository.create({
				owner: { ownerUserId: mockUserId, ownerOrganizationId: null },
				name: 'Notes' as RepositoryName,
				slug: 'notes' as RepositorySlug,
			})
		).toEqual(
			expect.objectContaining({
				id: '00000000-0000-4000-8000-000000000002',
				slug: 'notes',
				owner: { kind: 'user', handle: 'marta' },
			})
		)
		expect(insertMock).toHaveBeenCalledWith(repositories)
		expect(valuesMock).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
			name: 'Notes',
			slug: 'notes',
			description: undefined,
			visibility: undefined,
		})
		expect(returningMock).toHaveBeenCalledWith({ id: repositories.id })
		expect(findFirstRepositoryMock).not.toHaveBeenCalled()
	})

	test('creates an organization-owned repository', async () => {
		const organizationId =
			'00000000-0000-4000-8000-000000000050' as OrganizationId
		limitMock.mockResolvedValue([
			{
				...repositoryRow,
				ownerUserId: null,
				ownerOrganizationId: organizationId,
				ownerHandle: 'tessera',
			},
		])

		expect(
			await repositoriesRepository.create({
				owner: { ownerUserId: null, ownerOrganizationId: organizationId },
				name: 'Notes' as RepositoryName,
				slug: 'notes' as RepositorySlug,
			})
		).toEqual(
			expect.objectContaining({
				owner: { kind: 'organization', handle: 'tessera' },
			})
		)
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerUserId: null,
				ownerOrganizationId: organizationId,
			})
		)
	})

	test('finds a repository by owner username and slug', async () => {
		expect(
			await repositoriesRepository.find({
				handle: 'marta',
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
			owner: { kind: 'user', handle: 'marta' },
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

	test('resolves the owner behind a handle', async () => {
		limitMock.mockResolvedValueOnce([{ id: mockUserId }])

		expect(await repositoriesRepository.findOwner({ handle: 'marta' })).toEqual(
			{ ownerUserId: mockUserId, ownerOrganizationId: null }
		)
		expect(selectMock).toHaveBeenCalledWith({ id: user.id })
		expect(fromMock).toHaveBeenCalledWith(user)
		expect(subqueryWhereMock).toHaveBeenCalledWith(eq(user.username, 'marta'))
	})

	test('falls back to the organization behind a handle', async () => {
		const organizationId =
			'00000000-0000-4000-8000-000000000050' as OrganizationId
		limitMock
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ id: organizationId }])

		expect(
			await repositoriesRepository.findOwner({ handle: 'tessera' })
		).toEqual({ ownerUserId: null, ownerOrganizationId: organizationId })
		expect(selectMock).toHaveBeenNthCalledWith(1, { id: user.id })
		expect(selectMock).toHaveBeenNthCalledWith(2, { id: organization.id })
		expect(fromMock).toHaveBeenNthCalledWith(1, user)
		expect(fromMock).toHaveBeenNthCalledWith(2, organization)
		expect(subqueryWhereMock).toHaveBeenNthCalledWith(
			1,
			eq(user.username, 'tessera')
		)
		expect(subqueryWhereMock).toHaveBeenNthCalledWith(
			2,
			eq(organization.slug, 'tessera')
		)
	})

	test('returns no owner for an unknown handle', async () => {
		limitMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.findOwner({ handle: 'nobody' })
		).toBeUndefined()
	})

	test('returns undefined when owner handle and slug lookup misses', async () => {
		limitMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.find({
				handle: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).toBeUndefined()
	})

	test('returns undefined when the found row has no owner handle', async () => {
		limitMock.mockResolvedValue([{ ...repositoryRow, ownerHandle: null }])

		expect(
			await repositoriesRepository.find({
				handle: 'marta',
				slug: 'notes' as RepositorySlug,
			})
		).toBeUndefined()
	})

	test('throws a domain error when insert returning is empty', async () => {
		returningMock.mockResolvedValue([])

		await expect(
			repositoriesRepository.create({
				owner: { ownerUserId: mockUserId, ownerOrganizationId: null },
				name: 'Notes' as RepositoryName,
				slug: 'notes' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryCreateFailedError)
	})

	test('persists storage path for a created repository', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

		expect(
			await repositoriesRepository.updateStoragePath({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				slug: 'notes',
				storagePath: '/var/lib/tessera/repositories/repo.git',
				owner: { kind: 'user', handle: 'marta' },
			})
		)
		expect(updateMock).toHaveBeenCalledWith(repositories)
		expect(setMock).toHaveBeenCalledWith({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(whereMock).toHaveBeenCalledWith(eq(repositories.id, repositoryId))
		expect(updateReturningMock).toHaveBeenCalledWith({ id: repositories.id })
	})

	test('returns undefined when storage path update finds no repository', async () => {
		updateReturningMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.updateStoragePath({
				repositoryId: '00000000-0000-4000-8000-000000000404' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/missing.git',
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
				owner: { kind: 'user', handle: 'marta' },
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

	test('resets the failure tier when enabling GitHub mirroring and returns the sync request', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const syncRequest = {
			repositoryId,
			authorityGeneration: 1,
			requestedSyncVersion: 2,
		}
		updateReturningMock.mockResolvedValueOnce([syncRequest])

		expect(
			await repositoriesRepository.enableGitHubMirror({ repositoryId })
		).toEqual(syncRequest)
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mirrorMode: 'github_to_tessera',
				syncStatus: 'pending',
				syncFailureCount: 0,
				syncFailureCode: null,
				syncFailureReason: null,
			})
		)
	})

	test('cuts over a GitHub mirror to Tessera source', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const cutoverAt = new Date('2026-05-12T00:02:00Z')

		expect(
			await repositoriesRepository.cutoverGitHubMirror({
				repositoryId,
				actorUserId: mockUserId,
				cutoverAt,
			})
		).toEqual(
			expect.objectContaining({
				id: repositoryId,
				owner: { kind: 'user', handle: 'marta' },
			})
		)
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mirrorMode: 'tessera_source',
				nextSyncAt: null,
				syncLeaseOwner: null,
				syncLeaseAcquiredAt: null,
				syncLeaseExpiresAt: null,
				cutoverActorUserId: mockUserId,
				cutoverAt,
				cutoverFromMirrorMode: 'github_to_tessera',
			})
		)
		expect(updateReturningMock).toHaveBeenCalledWith({
			id: repositoryExternalSources.id,
		})
	})

	test('returns undefined when GitHub mirror cutover update is not eligible', async () => {
		updateReturningMock.mockResolvedValue([])

		expect(
			await repositoriesRepository.cutoverGitHubMirror({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				actorUserId: mockUserId,
				cutoverAt: new Date('2026-05-12T00:02:00Z'),
			})
		).toBeUndefined()
		expect(limitMock).not.toHaveBeenCalled()
	})

	test('offers organization owners and admins as privileged users', async () => {
		const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
		const organizationAdmin = {
			userId: '00000000-0000-4000-8000-000000000009' as UserId,
			username: 'admin',
		}
		limitMock.mockResolvedValueOnce([organizationAdmin])

		expect(
			await repositoriesRepository.listPrivilegedUsers({
				repositoryId,
				limit: 10,
			})
		).toEqual([organizationAdmin])

		expect(selectDistinctMock).toHaveBeenCalledWith({
			userId: user.id,
			username: user.username,
		})
		expect(fromMock).toHaveBeenCalledWith(repositories)
		expect(subqueryWhereMock).toHaveBeenCalledWith(
			and(
				eq(member.organizationId, repositories.ownerOrganizationId),
				inArray(member.role, ['owner', 'admin'])
			)
		)
		expect(selectWhereMock).toHaveBeenCalledWith(
			eq(repositories.id, repositoryId)
		)
		expect(orderByMock).toHaveBeenCalledWith(asc(user.username))
		expect(limitMock).toHaveBeenCalledWith(10)
	})
})
