import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubActorId,
	GitHubPullRequestMappingId,
	GitHubPullRequestReviewMappingId,
	GitHubPullRequestThreadMappingId,
	GitHubWebhookDeliveryId,
} from '@repo/db'
import {
	gitHubActors,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestReviewMappings,
	gitHubPullRequestThreadMappings,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviews,
	pullRequestThreads,
	repositoryExternalSources,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { getTableName, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { GitHubGroupedReviewThread } from '../helpers/github-pull-request-conversation'
import type {
	GitHubSyncReview,
	GitHubSyncReviewComment,
} from './github-sync.client.types'
import type { GitHubConversationTarget } from './github-sync.repository'
import {
	type GitHubConversationAnchor,
	GitHubSyncConversationsRepository,
	type ProjectPullRequestConversationParams,
} from './github-sync-conversations.repository'

const AUTHOR_ACTOR_ID = '00000000-0000-4000-8000-000000000001' as GitHubActorId
const RESOLVER_ACTOR_ID =
	'00000000-0000-4000-8000-000000000002' as GitHubActorId
const USER_ID = '00000000-0000-4000-8000-000000000003' as UserId
const THREAD_ID = '00000000-0000-4000-8000-000000000004' as PullRequestThreadId
const COMMENT_ID =
	'00000000-0000-4000-8000-000000000005' as PullRequestCommentId
const THREAD_MAPPING_ID =
	'00000000-0000-4000-8000-000000000006' as GitHubPullRequestThreadMappingId
const DELIVERY_ID =
	'00000000-0000-4000-8000-000000000007' as GitHubWebhookDeliveryId
const REVIEW_ID = '00000000-0000-4000-8000-000000000011' as PullRequestReviewId
const REVIEW_MAPPING_ID =
	'00000000-0000-4000-8000-000000000012' as GitHubPullRequestReviewMappingId
const TARGET: GitHubConversationTarget = {
	pullRequestMappingId:
		'00000000-0000-4000-8000-000000000008' as GitHubPullRequestMappingId,
	pullRequestId: '00000000-0000-4000-8000-000000000009' as PullRequestId,
	externalNodeId: 'pull-request-node',
	externalNumber: 7,
	baseSha: 'base-sha',
	headSha: 'head-sha',
}
const SYNCED_AT = new Date('2026-08-08T12:00:00Z')
const ANCHOR: GitHubConversationAnchor = {
	path: 'src/index.ts',
	side: 'right',
	line: 9,
	anchorSha: 'anchor-sha',
	baseSha: 'base-sha',
	headSha: 'head-sha',
	lineExcerpt: 'value',
}
const RESOLVER = {
	nodeId: 'resolver-node',
	numericId: 12n,
	login: 'olek',
	type: 'user' as const,
}

describe(GitHubSyncConversationsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: GitHubSyncConversationsRepository
	let db: MockDatabase

	beforeEach(async () => {
		db = createMockDatabase()
		db.queueSelect(repositoryExternalSources, [{ id: 'external-source' }])
		db.queueSelect(gitHubActors, [{ id: RESOLVER_ACTOR_ID, userId: USER_ID }])

		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncConversationsRepository,
				{ provide: Database, useValue: db.database },
			],
		}).compile()
		repository = moduleRef.get(GitHubSyncConversationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('never names a resolver on a thread GitHub reports as unresolved', async () => {
		db.queueInsert(pullRequestThreads, [{ id: THREAD_ID }])
		db.queueInsert(gitHubPullRequestThreadMappings, [{ id: THREAD_MAPPING_ID }])
		db.queueInsert(pullRequestComments, [{ id: COMMENT_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [
					{
						anchor: ANCHOR,
						providerOutdated: false,
						thread: groupedThread({ resolved: false, resolvedBy: RESOLVER }),
					},
				],
			})
		)

		expect(db.written('insert', pullRequestThreads)).toMatchObject([
			{ resolvedAt: null, resolvedByUserId: null },
		])
		expect(db.written('insert', gitHubPullRequestThreadMappings)).toMatchObject(
			[{ providerResolved: false, resolvedByActorId: RESOLVER_ACTOR_ID }]
		)
	})

	test('keeps the resolution of a thread GraphQL did not return', async () => {
		db.queueSelect(gitHubPullRequestThreadMappings, [
			{
				id: THREAD_MAPPING_ID,
				pullRequestThreadId: THREAD_ID,
				providerResolved: true,
				providerResolvedAt: new Date('2026-08-01T10:00:00Z'),
				providerOutdated: true,
				resolvedByActorId: RESOLVER_ACTOR_ID,
				deliveryId: null,
			},
		])
		db.queueInsert(pullRequestComments, [{ id: COMMENT_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [
					{ anchor: ANCHOR, thread: groupedThread({ resolved: undefined }) },
				],
			})
		)

		expect(db.written('update', gitHubPullRequestThreadMappings)).toMatchObject(
			[
				{
					providerResolved: true,
					providerResolvedAt: new Date('2026-08-01T10:00:00Z'),
					providerOutdated: true,
					resolvedByActorId: RESOLVER_ACTOR_ID,
				},
			]
		)
		expect(db.written('insert', pullRequestEvents)).toHaveLength(0)
	})

	test('defers the resolution transition until the thread can be anchored', async () => {
		db.queueSelect(gitHubPullRequestThreadMappings, [
			{
				id: THREAD_MAPPING_ID,
				pullRequestThreadId: null,
				providerResolved: false,
				providerResolvedAt: null,
				providerOutdated: false,
				resolvedByActorId: null,
				deliveryId: null,
			},
		])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [
					{ thread: groupedThread({ resolved: true, resolvedBy: RESOLVER }) },
				],
			})
		)

		expect(db.written('update', gitHubPullRequestThreadMappings)).toMatchObject(
			[{ providerResolved: false, providerResolvedAt: null }]
		)
		expect(db.written('insert', pullRequestEvents)).toHaveLength(0)
	})

	test('looks a thread up inside its pull request and ignores tombstoned rows', async () => {
		db.queueInsert(pullRequestThreads, [{ id: THREAD_ID }])
		db.queueInsert(gitHubPullRequestThreadMappings, [{ id: THREAD_MAPPING_ID }])
		db.queueInsert(pullRequestComments, [{ id: COMMENT_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [{ anchor: ANCHOR, thread: groupedThread({}) }],
			})
		)

		const lookup = db.condition('select', gitHubPullRequestThreadMappings)

		expect(lookup).toContain('"pull_request_mapping_id" = $')
		expect(lookup).toContain('"external_node_id" = $')
		expect(lookup).toContain('"deleted_at" is null')
	})

	test('takes a deleted thread down with everything still hanging on it', async () => {
		db.queueSelect(gitHubPullRequestThreadMappings, [
			{
				id: THREAD_MAPPING_ID,
				externalNodeId: 'thread-node',
				rootCommentNodeId: 'root-comment-node',
				pullRequestThreadId: THREAD_ID,
			},
		])
		db.queueDelete(pullRequestComments, [{ id: COMMENT_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({ threads: [] })
		)

		expect(
			db.written('update', gitHubPullRequestCommentMappings)
		).toMatchObject([
			{ providerDeletedAt: SYNCED_AT, pullRequestCommentId: null },
		])
		expect(db.deleted(pullRequestThreads)).toHaveLength(1)
		expect(db.written('update', gitHubPullRequestThreadMappings)).toMatchObject(
			[
				{ pullRequestThreadId: null },
				{
					deletedAt: SYNCED_AT,
					externalNodeId: `deleted:${THREAD_MAPPING_ID}:thread-node`,
					rootCommentNodeId: `deleted:${THREAD_MAPPING_ID}:root-comment-node`,
				},
			]
		)
	})

	test('does not borrow the provenance of a delivery about another thread', async () => {
		db.queueInsert(pullRequestThreads, [{ id: THREAD_ID }])
		db.queueInsert(gitHubPullRequestThreadMappings, [{ id: THREAD_MAPPING_ID }])
		db.queueInsert(pullRequestComments, [{ id: COMMENT_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({
				deliveries: [
					{
						deliveryId: DELIVERY_ID,
						eventName: 'pull_request_review_thread',
						action: 'resolved',
						subjectNumber: 7,
						targetResourceNodeId: 'another-thread-node',
						actorId: AUTHOR_ACTOR_ID,
						receivedAt: new Date('2026-08-07T10:00:00Z'),
					},
				],
				threads: [
					{
						anchor: ANCHOR,
						thread: groupedThread({ resolved: true, resolvedBy: RESOLVER }),
					},
				],
			})
		)

		expect(db.written('insert', gitHubPullRequestThreadMappings)).toMatchObject(
			[{ deliveryId: null, providerResolvedAt: SYNCED_AT }]
		)
	})

	test('clears the placement the provider stopped reporting', async () => {
		db.queueInsert(pullRequestThreads, [{ id: THREAD_ID }])
		db.queueInsert(gitHubPullRequestThreadMappings, [{ id: THREAD_MAPPING_ID }])
		db.queueSelect(gitHubPullRequestCommentMappings, [
			{ id: 'comment-mapping', pullRequestCommentId: COMMENT_ID },
		])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [
					{
						anchor: ANCHOR,
						thread: groupedThread({
							root: reviewComment({
								line: undefined,
								commitId: undefined,
								diffHunk: undefined,
							}),
						}),
					},
				],
			})
		)

		expect(
			db.written('update', gitHubPullRequestCommentMappings)
		).toMatchObject([
			{ line: null, commitId: null, diffHunk: null, subjectType: 'line' },
		])
	})

	test('skips a blank issue comment instead of creating an empty thread', async () => {
		await repository.projectPullRequestConversation(
			projectionParams({
				conversation: {
					issueComments: [
						{
							nodeId: 'issue-comment-node',
							numericId: 31n,
							author: RESOLVER,
							body: '   ',
							htmlUrl: 'https://github.com/org/repo/issues/7#issuecomment-31',
							createdAt: SYNCED_AT,
							updatedAt: SYNCED_AT,
						},
					],
					reviewComments: [],
					reviews: [],
					requestedReviewers: [],
					reviewThreads: [],
				},
				threads: [],
			})
		)

		expect(db.written('insert', pullRequestThreads)).toHaveLength(0)
		expect(db.written('insert', gitHubPullRequestThreadMappings)).toHaveLength(
			0
		)
	})

	test('keeps the recorded outcome when a submitted review is dismissed', async () => {
		db.queueSelect(gitHubPullRequestReviewMappings, [
			{
				id: REVIEW_MAPPING_ID,
				pullRequestReviewId: REVIEW_ID,
				providerDismissedAt: null,
			},
		])
		db.queueSelect(pullRequestReviews, [
			{ outcome: 'approve', state: 'submitted' },
		])
		db.queueInsert(pullRequestEvents, [{ id: 'event' }])

		await repository.projectPullRequestConversation(
			projectionParams({ conversation: conversation([dismissedReview()]) })
		)

		expect(db.written('update', pullRequestReviews)).toMatchObject([
			{ state: 'dismissed', outcome: 'approve', dismissedAt: SYNCED_AT },
		])
	})

	test('projects a review dismissed before Tessera saw it without an outcome', async () => {
		db.queueInsert(pullRequestReviews, [{ id: REVIEW_ID }])
		db.queueInsert(pullRequestEvents, [{ id: 'event' }])

		await repository.projectPullRequestConversation(
			projectionParams({ conversation: conversation([dismissedReview()]) })
		)

		expect(db.written('insert', pullRequestReviews)).toMatchObject([
			{ state: 'dismissed', outcome: null, dismissedAt: SYNCED_AT },
		])

		const [event] = db.written('insert', pullRequestEvents)

		expect(event?.type).toBe('review_submitted')
		expect(event?.payload).toEqual({
			reviewId: REVIEW_ID,
			outcome: undefined,
			headSha: TARGET.headSha,
		})
	})

	test('tombstones a review comment whose body GitHub cleared', async () => {
		db.queueSelect(gitHubPullRequestThreadMappings, [
			{
				id: THREAD_MAPPING_ID,
				pullRequestThreadId: THREAD_ID,
				providerResolved: false,
				providerResolvedAt: null,
				providerOutdated: false,
				resolvedByActorId: null,
				deliveryId: null,
			},
		])
		db.queueSelect(gitHubPullRequestCommentMappings, [
			{ id: 'comment-mapping', pullRequestCommentId: COMMENT_ID },
		])
		db.queueDelete(pullRequestComments, [{ threadId: THREAD_ID }])

		await repository.projectPullRequestConversation(
			projectionParams({
				threads: [
					{
						anchor: ANCHOR,
						thread: groupedThread({ root: reviewComment({ body: '   ' }) }),
					},
				],
			})
		)

		expect(db.written('update', pullRequestComments)).toHaveLength(0)
		expect(
			db.written('update', gitHubPullRequestCommentMappings)
		).toMatchObject([
			{ providerDeletedAt: SYNCED_AT, pullRequestCommentId: null },
		])
		expect(db.deleted(pullRequestThreads)).toHaveLength(1)
	})
})

function projectionParams(
	overrides: Partial<ProjectPullRequestConversationParams> = {}
): ProjectPullRequestConversationParams {
	return {
		actorIds: new Map([
			['author-node', AUTHOR_ACTOR_ID],
			['resolver-node', RESOLVER_ACTOR_ID],
		]),
		authorityGeneration: 2,
		conversation: {
			issueComments: [],
			reviewComments: [],
			reviews: [],
			requestedReviewers: [],
			reviewThreads: [],
		},
		deliveries: [],
		leaseOwner: 'lease-owner',
		orphanedComments: [],
		repositoryId: '00000000-0000-4000-8000-000000000010' as RepositoryId,
		syncedAt: SYNCED_AT,
		syncVersion: 5,
		target: TARGET,
		threads: [],
		...overrides,
	}
}

function conversation(
	reviews: GitHubSyncReview[]
): ProjectPullRequestConversationParams['conversation'] {
	return {
		issueComments: [],
		reviewComments: [],
		reviews,
		requestedReviewers: [],
		reviewThreads: [],
	}
}

function dismissedReview(
	overrides: Partial<GitHubSyncReview> = {}
): GitHubSyncReview {
	return {
		nodeId: 'review-node',
		numericId: 41n,
		reviewer: RESOLVER,
		body: 'Please rework this',
		outcome: undefined,
		dismissed: true,
		htmlUrl: 'https://github.com/org/repo/pull/7#pullrequestreview-41',
		submittedAt: new Date('2026-08-07T10:00:00Z'),
		...overrides,
	}
}

function reviewComment(
	overrides: Partial<GitHubSyncReviewComment> = {}
): GitHubSyncReviewComment {
	return {
		nodeId: 'root-comment-node',
		numericId: 21n,
		author: {
			nodeId: 'author-node',
			numericId: 11n,
			login: 'marta',
			type: 'user',
		},
		body: 'Inline',
		htmlUrl: 'https://github.com/org/repo/pull/7#discussion_r21',
		subjectType: 'line',
		path: 'src/index.ts',
		side: 'right',
		line: 9,
		originalLine: 8,
		commitId: 'head-sha',
		originalCommitId: 'historical-head',
		diffHunk: '@@ -8 +9 @@\n+value',
		createdAt: new Date('2026-08-08T10:00:00Z'),
		updatedAt: new Date('2026-08-08T10:00:00Z'),
		...overrides,
	}
}

function groupedThread(
	overrides: Partial<GitHubGroupedReviewThread>
): GitHubGroupedReviewThread {
	const root = overrides.root ?? reviewComment()

	return {
		externalNodeId: 'thread-node',
		rootCommentNodeId: root.nodeId,
		subjectType: 'line',
		resolved: false,
		...overrides,
		root,
		comments: overrides.comments ?? [root],
	}
}

interface MockWrite {
	kind: 'insert' | 'update' | 'delete'
	table: string
	values?: Record<string, unknown>
}

interface MockQueryState {
	kind: 'select' | 'insert' | 'update' | 'delete'
	statement: number
	table?: string
}

type MockQueryChain = Promise<unknown[]> & {
	from: (table: unknown) => MockQueryChain
	set: (values: Record<string, unknown>) => MockQueryChain
	values: (values: Record<string, unknown>) => MockQueryChain
	where: (condition?: unknown) => MockQueryChain
	orderBy: () => MockQueryChain
	limit: () => MockQueryChain
	for: () => MockQueryChain
	returning: () => MockQueryChain
}

interface MockDatabase {
	database: { transaction: (callback: (tx: unknown) => unknown) => unknown }
	queueSelect: (table: PgTable, rows: unknown[]) => void
	queueInsert: (table: PgTable, rows: unknown[]) => void
	queueDelete: (table: PgTable, rows: unknown[]) => void
	written: (
		kind: MockWrite['kind'],
		table: PgTable
	) => Record<string, unknown>[]
	deleted: (table: PgTable) => MockWrite[]
	condition: (kind: MockQueryState['kind'], table: PgTable) => string
}

/**
 * Enough of Drizzle's builder to run a whole projection: every chain is
 * awaitable, rows are queued per table and statement kind, and what was written
 * or filtered on is recorded for the assertions.
 */
function createMockDatabase(): MockDatabase {
	const rows = new Map<string, unknown[][]>()
	const answers = new Map<number, unknown[]>()
	const writes: MockWrite[] = []
	const conditions = new Map<string, unknown>()
	let nextStatement = 0

	function key(kind: string, table: string | undefined): string {
		return `${kind}:${table}`
	}

	function queue(kind: string, table: PgTable, result: unknown[]): void {
		const existing = rows.get(key(kind, getTableName(table))) ?? []

		rows.set(key(kind, getTableName(table)), [...existing, result])
	}

	// Every link of a chain is awaitable, so one statement resolves its rows once
	// and every link after it reads that same answer.
	function take(state: MockQueryState): unknown[] {
		if (!state.table) return []

		const answered = answers.get(state.statement)

		if (answered) return answered

		const result = rows.get(key(state.kind, state.table))?.shift() ?? []
		answers.set(state.statement, result)

		return result
	}

	function chain(state: MockQueryState): MockQueryChain {
		const methods = {
			from: (table: unknown) =>
				chain({ ...state, table: getTableName(table as PgTable) }),
			set: (values: Record<string, unknown>) => {
				writes.push({ kind: 'update', table: `${state.table}`, values })

				return chain(state)
			},
			values: (values: Record<string, unknown>) => {
				writes.push({ kind: 'insert', table: `${state.table}`, values })

				return chain(state)
			},
			where: (condition?: unknown) => {
				const conditionKey = key(state.kind, state.table)

				if (!conditions.has(conditionKey))
					conditions.set(conditionKey, condition)

				return chain(state)
			},
			orderBy: () => chain(state),
			limit: () => chain(state),
			for: () => chain(state),
			returning: () => chain(state),
		}

		return Object.assign(
			Promise.resolve().then(() => take(state)),
			methods
		)
	}

	function statement(kind: MockQueryState['kind'], table?: PgTable) {
		nextStatement += 1

		return chain({
			kind,
			statement: nextStatement,
			table: table ? getTableName(table) : undefined,
		})
	}

	return {
		database: {
			transaction: callback =>
				callback({
					execute: vi.fn().mockResolvedValue([]),
					select: () => statement('select'),
					insert: (table: PgTable) => statement('insert', table),
					update: (table: PgTable) => statement('update', table),
					delete: (table: PgTable) => {
						writes.push({ kind: 'delete', table: getTableName(table) })

						return statement('delete', table)
					},
				}),
		},
		queueSelect: (table, result) => queue('select', table, result),
		queueInsert: (table, result) => queue('insert', table, result),
		queueDelete: (table, result) => queue('delete', table, result),
		written: (kind, table) =>
			writes.flatMap(write =>
				write.kind === kind &&
				write.table === getTableName(table) &&
				write.values
					? [write.values]
					: []
			),
		deleted: table =>
			writes.filter(
				write => write.kind === 'delete' && write.table === getTableName(table)
			),
		condition: (kind, table) => {
			const condition = conditions.get(key(kind, getTableName(table)))

			return condition ? new PgDialect().sqlToQuery(condition as SQL).sql : ''
		},
	}
}
