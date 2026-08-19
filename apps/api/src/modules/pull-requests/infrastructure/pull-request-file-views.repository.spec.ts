import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { pullRequestFileViews } from '@repo/db'
import type { PullRequestId, UserId } from '@repo/domain'
import { PgDialect } from 'drizzle-orm/pg-core'
import { PullRequestFileViewsRepository } from './pull-request-file-views.repository'

const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const userId = '00000000-0000-4000-8000-000000000001' as UserId
const headSha = 'b'.repeat(40)
const scope = {
	pullRequestId,
	userId,
	path: 'src/index.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
}

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
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const updateWhereMock = vi.fn()

	beforeEach(async () => {
		vi.resetAllMocks()
		fromMock.mockReturnValue({ where: whereMock })
		selectMock.mockReturnValue({ from: fromMock })
		valuesMock.mockResolvedValue(undefined)
		insertMock.mockReturnValue({ values: valuesMock })
		deleteWhereMock.mockResolvedValue(undefined)
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		updateWhereMock.mockResolvedValue(undefined)
		setMock.mockReturnValue({ where: updateWhereMock })
		updateMock.mockReturnValue({ set: setMock })
		const transaction = {
			execute: executeMock,
			select: selectMock,
			insert: insertMock,
			update: updateMock,
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

	test('lists the blob identity of every tick for one user', async () => {
		const views = [
			{
				path: 'src/a.ts',
				baseBlobId: 'base-a',
				headBlobId: 'head-a',
				headSha,
			},
		]
		orderByMock.mockResolvedValue(views)
		whereMock.mockReturnValue({ orderBy: orderByMock })

		expect(await repository.listViews({ pullRequestId, userId })).toEqual(views)
		expect(orderByMock).toHaveBeenCalledOnce()
		const [condition] = whereMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(condition).params).toEqual([
			pullRequestId,
			userId,
		])
	})

	test('clears the path and the row a rename left behind', async () => {
		await repository.clearViewed(scope)

		expect(deleteMock).toHaveBeenCalledWith(pullRequestFileViews)
		expect(deleteWhereMock).toHaveBeenCalledOnce()
		const [condition] = deleteWhereMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(condition).params).toEqual([
			pullRequestId,
			userId,
			scope.path,
			scope.baseBlobId,
			scope.headBlobId,
		])
	})

	test('returns already viewed before enforcing the cap under an advisory lock', async () => {
		limitMock.mockResolvedValue([{ path: scope.path }])
		whereMock.mockReturnValue({ limit: limitMock })

		expect(
			await repository.markViewed({ ...scope, headSha, limit: 1000 })
		).toBe('already_viewed')
		expect(transactionMock).toHaveBeenCalledOnce()
		expect(executeMock).toHaveBeenCalledOnce()
		const [lock] = executeMock.mock.calls[0] ?? []
		const lockQuery = new PgDialect().sqlToQuery(lock)
		expect(lockQuery.sql).toContain('pg_advisory_xact_lock')
		expect(lockQuery.params).toContain(
			`pull_request_file_views:${userId}:${pullRequestId}`
		)
		expect(selectMock).toHaveBeenCalledOnce()
		expect(updateMock).toHaveBeenCalledWith(pullRequestFileViews)
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('refuses a new path at the cap', async () => {
		limitMock.mockResolvedValue([])
		whereMock
			.mockReturnValueOnce({ limit: limitMock })
			.mockResolvedValueOnce([{ total: 1000 }])

		expect(
			await repository.markViewed({ ...scope, headSha, limit: 1000 })
		).toBe('limit_reached')
		expect(executeMock).toHaveBeenCalledOnce()
		expect(insertMock).not.toHaveBeenCalled()
	})

	test('inserts a new path below the cap', async () => {
		limitMock.mockResolvedValue([])
		whereMock
			.mockReturnValueOnce({ limit: limitMock })
			.mockResolvedValueOnce([{ total: 999 }])

		expect(
			await repository.markViewed({ ...scope, headSha, limit: 1000 })
		).toBe('marked')
		expect(insertMock).toHaveBeenCalledWith(pullRequestFileViews)
		expect(valuesMock).toHaveBeenCalledWith({
			...scope,
			headSha,
			viewedAt: expect.any(Date),
		})
	})
})
