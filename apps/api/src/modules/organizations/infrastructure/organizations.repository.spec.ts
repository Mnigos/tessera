import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { invitation, member, organization } from '@repo/db'
import type { OrganizationId, UserId } from '@repo/domain'
import { OrganizationsRepository } from './organizations.repository'

const userId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const organizationView = {
	id: organizationId,
	slug: 'tessera',
	name: 'Tessera',
	logo: null,
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
}

describe(OrganizationsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: OrganizationsRepository
	const select = vi.fn()
	const transaction = vi.fn()
	const findFirst = vi.fn()

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationsRepository,
				{
					provide: Database,
					useValue: {
						select,
						transaction,
						query: { account: { findFirst } },
					},
				},
			],
		}).compile()

		repository = moduleRef.get(OrganizationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists memberships in repository order', async () => {
		const rows = [{ ...organizationView, role: 'owner' as const }]
		const orderBy = vi.fn().mockResolvedValue(rows)
		const where = vi.fn(() => ({ orderBy }))
		const innerJoin = vi.fn(() => ({ where }))
		const from = vi.fn(() => ({ innerJoin }))
		select.mockReturnValue({ from })

		expect(await repository.listMemberships({ userId })).toEqual(rows)
		expect(innerJoin).toHaveBeenCalled()
		expect(where).toHaveBeenCalled()
		expect(orderBy).toHaveBeenCalledTimes(1)
	})

	test('finds an organization by id', async () => {
		const limit = vi.fn().mockResolvedValue([organizationView])
		const where = vi.fn(() => ({ limit }))
		select.mockReturnValue({ from: vi.fn(() => ({ where })) })

		expect(await repository.findById({ organizationId })).toEqual(
			organizationView
		)
	})

	test('finds a member role and reports a missing membership', async () => {
		const limit = vi
			.fn()
			.mockResolvedValueOnce([{ role: 'admin' }])
			.mockResolvedValueOnce([])
		const where = vi.fn(() => ({ limit }))
		select.mockReturnValue({ from: vi.fn(() => ({ where })) })

		expect(await repository.findMemberRole({ organizationId, userId })).toBe(
			'admin'
		)
		expect(await repository.findMemberRole({ organizationId, userId })).toBe(
			undefined
		)
	})

	test.each([
		['username', [{ id: userId }], []],
		['organization slug', [], [{ id: organizationId }]],
	] as const)('reports a taken %s', async (_label, users, organizations) => {
		select
			.mockReturnValueOnce(limitedRowsResult([...users]))
			.mockReturnValueOnce(limitedRowsResult([...organizations]))

		expect(await repository.isHandleTaken({ handle: 'TeSsErA' })).toBe(true)
	})

	test('reports an available handle and accepts a rename exclusion', async () => {
		select
			.mockReturnValueOnce(limitedRowsResult([]))
			.mockReturnValueOnce(limitedRowsResult([]))

		expect(
			await repository.isHandleTaken({
				handle: 'tessera-next',
				ignoreOrganizationId: organizationId,
			})
		).toBe(false)
		expect(select).toHaveBeenCalledTimes(2)
	})

	test('loads the newest linked GitHub account identity', async () => {
		const identity = {
			accountId: '42',
			accessToken: 'github-token',
			accessTokenExpiresAt: null,
		}
		findFirst.mockResolvedValue(identity)

		expect(await repository.findGitHubAccount({ userId })).toEqual(identity)
		expect(findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				columns: {
					accountId: true,
					accessToken: true,
					accessTokenExpiresAt: true,
				},
			})
		)
	})

	test.each([
		['missing organization', [lockOrganizationResult()], 'not-found'],
		[
			'missing membership',
			[
				lockOrganizationResult(undefined, [{ slug: 'tessera' }]),
				limitedRowsResult([]),
			],
			'not-found',
		],
		[
			'admin actor',
			[
				lockOrganizationResult(undefined, [{ slug: 'tessera' }]),
				limitedRowsResult([{ role: 'admin' }]),
			],
			'forbidden',
		],
	] as const)('stops deletion for a %s', async (_label, selections, kind) => {
		const deleteRow = vi.fn()
		const transactionSelect = vi.fn()
		for (const selection of selections)
			transactionSelect.mockReturnValueOnce(selection)
		transaction.mockImplementation(callback =>
			callback({ select: transactionSelect, delete: deleteRow })
		)

		expect(
			await repository.deleteOwned({
				organizationId,
				userId,
				confirmationSlug: 'tessera',
			})
		).toMatchObject({ kind })
		expect(deleteRow).not.toHaveBeenCalled()
	})

	test('checks the locked slug before counting repositories', async () => {
		const transactionSelect = vi
			.fn()
			.mockReturnValueOnce(
				lockOrganizationResult(undefined, [{ slug: 'renamed' }])
			)
			.mockReturnValueOnce(limitedRowsResult([{ role: 'owner' }]))
		const deleteRow = vi.fn()
		transaction.mockImplementation(callback =>
			callback({ select: transactionSelect, delete: deleteRow })
		)

		expect(
			await repository.deleteOwned({
				organizationId,
				userId,
				confirmationSlug: 'tessera',
			})
		).toEqual({ kind: 'confirmation-mismatch' })
		expect(transactionSelect).toHaveBeenCalledTimes(2)
		expect(deleteRow).not.toHaveBeenCalled()
	})

	test('blocks deletion before removing related rows when repositories exist', async () => {
		const deleteRow = vi.fn()
		const transactionSelect = vi
			.fn()
			.mockReturnValueOnce(
				lockOrganizationResult(undefined, [{ slug: 'tessera' }])
			)
			.mockReturnValueOnce(limitedRowsResult([{ role: 'owner' }]))
			.mockReturnValueOnce(repositoryCountResult(2))
		transaction.mockImplementation(callback =>
			callback({ select: transactionSelect, delete: deleteRow })
		)

		expect(
			await repository.deleteOwned({
				organizationId,
				userId,
				confirmationSlug: 'tessera',
			})
		).toEqual({ kind: 'has-repositories', repositoryCount: 2 })
		expect(deleteRow).not.toHaveBeenCalled()
	})

	test('locks, counts, then deletes invitations, members, and organization', async () => {
		const lockForUpdate = vi.fn().mockResolvedValue([])
		const transactionSelect = vi
			.fn()
			.mockReturnValueOnce(
				lockOrganizationResult(lockForUpdate, [{ slug: 'tessera' }])
			)
			.mockReturnValueOnce(limitedRowsResult([{ role: 'owner' }]))
			.mockReturnValueOnce(repositoryCountResult(0))
		const where = vi.fn().mockResolvedValue(undefined)
		const deleteRow = vi.fn((_table: unknown) => ({ where }))
		transaction.mockImplementation(callback =>
			callback({ select: transactionSelect, delete: deleteRow })
		)

		expect(
			await repository.deleteOwned({
				organizationId,
				userId,
				confirmationSlug: 'tessera',
			})
		).toEqual({ kind: 'deleted' })
		expect(lockForUpdate).toHaveBeenCalledWith('update')
		expect(deleteRow.mock.calls.map(([table]) => table)).toEqual([
			invitation,
			member,
			organization,
		])
		expect(where).toHaveBeenCalledTimes(3)
	})
})

function lockOrganizationResult(lockForUpdate = vi.fn(), rows: object[] = []) {
	lockForUpdate.mockResolvedValue(rows)

	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(() => ({ for: lockForUpdate })),
			})),
		})),
	}
}

function limitedRowsResult(rows: object[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
		})),
	}
}

function repositoryCountResult(value: number) {
	return {
		from: vi.fn(() => ({
			where: vi.fn().mockResolvedValue([{ value }]),
		})),
	}
}
