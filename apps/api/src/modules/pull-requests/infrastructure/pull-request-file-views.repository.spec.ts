import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { pullRequestFileViews } from '@repo/db'
import type { PullRequestId, UserId } from '@repo/domain'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PullRequestFileViewsRepository } from './pull-request-file-views.repository'

const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const userId = '00000000-0000-4000-8000-000000000001' as UserId
const headSha = 'b'.repeat(40)
const scope = { pullRequestId, userId, headSha, path: 'src/index.ts' }

describe(PullRequestFileViewsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestFileViewsRepository

	const transactionMock = vi.fn()
	const executeMock = vi.fn()
	const selectMock = vi.fn()
	const fromMock = vi.fn()
	const whereMock = vi.fn()
	const orderByMock = vi.fn()
	const limitMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()

	beforeEach(async () => {
		vi.resetAllMocks()
		fromMock.mockReturnValue({ where: whereMock })
		selectMock.mockReturnValue({ from: fromMock })
		valuesMock.mockResolvedValue(undefined)
		insertMock.mockReturnValue({ values: valuesMock })
		deleteWhereMock.mockResolvedValue(undefined)
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		const transaction = {
			execute: executeMock,
			select: selectMock,
			insert: insertMock,
		}
		transactionMock.mockImplementation(callback => callback(transaction))

		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestFileViewsRepository,
				{
					provide: Database,
					useValue: {
						select: selectMock,
						delete: deleteMock,
						transaction: transactionMock,
					},
				},
			],
		}).compile()

		repository = moduleRef.get(PullRequestFileViewsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists paths in repository order for one user and head', async () => {
		orderByMock.mockResolvedValue([{ path: 'src/a.ts' }, { path: 'src/b.ts' }])
		whereMock.mockReturnValue({ orderBy: orderByMock })

		expect(
			await repository.listPaths({ pullRequestId, userId, headSha })
		).toEqual(['src/a.ts', 'src/b.ts'])
		expect(orderByMock).toHaveBeenCalledOnce()
		const [condition] = whereMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(condition).params).toEqual([
			pullRequestId,
			userId,
			headSha,
		])
	})

	test('clears one exact viewed path idempotently', async () => {
		await repository.clearViewed(scope)

		expect(deleteMock).toHaveBeenCalledWith(pullRequestFileViews)
		expect(deleteWhereMock).toHaveBeenCalledOnce()
		const [condition] = deleteWhereMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(condition).params).toEqual([
			pullRequestId,
			userId,
			headSha,
			scope.path,
		])
	})

	test('returns already viewed before enforcing the cap under an advisory lock', async () => {
		limitMock.mockResolvedValue([{ path: scope.path }])
		whereMock.mockReturnValue({ limit: limitMock })

		expect(await repository.markViewed({ ...scope, limit: 1000 })).toBe(
			'already_viewed'
		)
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(executeMock).toHaveBeenCalledOnce()
		const [lock] = executeMock.mock.calls[0] ?? []
		const lockQuery = new PgDialect().sqlToQuery(lock)
		expect(lockQuery.sql).toContain('pg_advisory_xact_lock')
		expect(lockQuery.params).toContain(
			`pull_request_file_views:${userId}:${pullRequestId}:${headSha}`
		)
		expect(selectMock).toHaveBeenCalledOnce()
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('refuses a new path at the per-head cap', async () => {
		limitMock.mockResolvedValue([])
		whereMock
			.mockReturnValueOnce({ limit: limitMock })
			.mockResolvedValueOnce([{ total: 1000 }])

		expect(await repository.markViewed({ ...scope, limit: 1000 })).toBe(
			'limit_reached'
		)
		expect(executeMock).toHaveBeenCalledOnce()
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('inserts a new path below the cap', async () => {
		limitMock.mockResolvedValue([])
		whereMock
			.mockReturnValueOnce({ limit: limitMock })
			.mockResolvedValueOnce([{ total: 999 }])

		expect(await repository.markViewed({ ...scope, limit: 1000 })).toBe(
			'marked'
		)
		expect(insertMock).toHaveBeenCalledWith(pullRequestFileViews)
		expect(valuesMock).toHaveBeenCalledWith(scope)
	})
})
