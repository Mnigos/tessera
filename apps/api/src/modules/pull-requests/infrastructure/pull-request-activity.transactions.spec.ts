import { Database } from '@config/database'
import { pullRequests } from '@repo/db'
import type { PullRequestId } from '@repo/domain'
import { PgDialect } from 'drizzle-orm/pg-core'
import { touchPullRequestActivity } from './pull-request-activity.transactions'

const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId

describe(touchPullRequestActivity.name, () => {
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const whereMock = vi.fn()
	const database = { update: updateMock } as unknown as Database

	beforeEach(() => {
		whereMock.mockResolvedValue(undefined)
		setMock.mockReturnValue({ where: whereMock })
		updateMock.mockReturnValue({ set: setMock })
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('does nothing when there are no pull requests to touch', async () => {
		await touchPullRequestActivity(database, { pullRequestIds: [] })

		expect(updateMock).not.toHaveBeenCalled()
	})

	test('moves activity forward without changing the pull request update time', async () => {
		const occurredAt = new Date('2026-08-27T10:00:00.123Z')

		await touchPullRequestActivity(database, {
			pullRequestIds: [pullRequestId],
			occurredAt,
		})

		expect(updateMock).toHaveBeenCalledWith(pullRequests)
		const [{ lastActivityAt, updatedAt }] = setMock.mock.calls[0] ?? []
		const activityQuery = new PgDialect().sqlToQuery(lastActivityAt)
		const updatedQuery = new PgDialect().sqlToQuery(updatedAt)
		const [condition] = whereMock.mock.calls[0] ?? []
		const conditionQuery = new PgDialect().sqlToQuery(condition)

		expect(activityQuery.sql).toContain('greatest')
		expect(activityQuery.params).toContain(occurredAt.toISOString())
		expect(updatedQuery.sql).toContain('"pull_requests"."updated_at"')
		expect(conditionQuery.params).toEqual([pullRequestId])
	})

	test('uses database time when the event has no explicit timestamp', async () => {
		await touchPullRequestActivity(database, {
			pullRequestIds: [pullRequestId],
		})

		const [{ lastActivityAt }] = setMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(lastActivityAt).sql).toContain('now()')
	})
})
