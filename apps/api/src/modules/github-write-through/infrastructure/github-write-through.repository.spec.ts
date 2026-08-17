import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubActorId,
	GitHubPullRequestMappingId,
	GitHubPullRequestThreadMappingId,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { GitHubWriteThroughRepository } from './github-write-through.repository'

const THREAD_ID = '00000000-0000-4000-8000-000000000001' as PullRequestThreadId
const THREAD_MAPPING_ID =
	'00000000-0000-4000-8000-000000000002' as GitHubPullRequestThreadMappingId
const PULL_REQUEST_ID = '00000000-0000-4000-8000-000000000003' as PullRequestId
const REPOSITORY_ID = '00000000-0000-4000-8000-000000000004' as RepositoryId
const USER_ID = '00000000-0000-4000-8000-000000000005' as UserId
const ACTOR_ID = '00000000-0000-4000-8000-000000000006' as GitHubActorId
const COMMENT_ID =
	'00000000-0000-4000-8000-000000000007' as PullRequestCommentId
const PULL_REQUEST_MAPPING_ID =
	'00000000-0000-4000-8000-000000000008' as GitHubPullRequestMappingId

describe(GitHubWriteThroughRepository.name, () => {
	let moduleRef: TestingModule
	let repository: GitHubWriteThroughRepository
	const conditions: unknown[] = []
	const pages: unknown[][] = []
	const returning = vi.fn()
	const values = vi.fn()

	beforeEach(async () => {
		conditions.length = 0
		pages.length = 0
		const limit = vi.fn(() => Promise.resolve(pages.shift() ?? []))
		const where = vi.fn((condition: unknown) => {
			conditions.push(condition)

			return { limit, orderBy: vi.fn(() => ({ limit })) }
		})
		const select = vi.fn(() => ({
			from: vi.fn(() => ({ where })),
		}))
		const onConflictDoNothing = vi.fn(() => ({ returning }))
		values.mockReturnValue({ onConflictDoNothing, returning })
		const insert = vi.fn(() => ({ values }))
		const updateWhere = vi.fn(() => ({ returning }))
		const set = vi.fn(() => ({ where: updateWhere }))
		const update = vi.fn(() => ({ set }))
		const transaction = vi.fn(callback =>
			callback({
				execute: vi.fn(),
				insert,
				select,
				update,
			})
		)
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubWriteThroughRepository,
				{ provide: Database, useValue: { select, transaction } },
			],
		}).compile()
		repository = moduleRef.get(GitHubWriteThroughRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('targets only the mapped root comment when replying to a thread', async () => {
		pages.push(
			[
				{
					threadMappingId: THREAD_MAPPING_ID,
					externalNodeId: 'thread-node',
				},
			],
			[{ externalNumericId: 201n }]
		)

		expect(await repository.findThreadTarget({ threadId: THREAD_ID })).toEqual({
			threadMappingId: THREAD_MAPPING_ID,
			externalNodeId: 'thread-node',
			rootCommentNumericId: 201n,
		})
		const threadQuery = toQuery(conditions[0])
		const rootCommentQuery = toQuery(conditions[1])
		expect(threadQuery.sql).toContain(
			'"github_pull_request_thread_mappings"."pull_request_thread_id" = $1'
		)
		expect(threadQuery.sql).toContain(
			'"github_pull_request_thread_mappings"."deleted_at" is null'
		)
		expect(threadQuery.params).toContain(THREAD_ID)
		expect(rootCommentQuery.sql).toContain(
			'"github_pull_request_comment_mappings"."thread_mapping_id" = $1'
		)
		expect(rootCommentQuery.sql).toContain(
			'"github_pull_request_comment_mappings"."kind" = $2'
		)
		expect(rootCommentQuery.sql).toContain(
			'"github_pull_request_comment_mappings"."parent_external_numeric_id" is null'
		)
		expect(rootCommentQuery.sql).toContain(
			'"github_pull_request_comment_mappings"."provider_deleted_at" is null'
		)
		expect(rootCommentQuery.params).toEqual([THREAD_MAPPING_ID, 'review'])
	})

	test.each([
		['same-side', 'right', 7],
		['cross-side', 'left', null],
	] as const)('echoes a %s provider range', async (_name, startSide, expectedStartLine) => {
		pages.push([{ userId: USER_ID }])
		returning
			.mockResolvedValueOnce([{ requestedSyncVersion: 1 }])
			.mockResolvedValueOnce([{ id: THREAD_ID }])
			.mockResolvedValueOnce([{ id: THREAD_MAPPING_ID }])
			.mockResolvedValueOnce([{ id: ACTOR_ID }])
			.mockResolvedValueOnce([{ id: COMMENT_ID }])

		expect(
			await repository.echoReviewComment({
				actorUserId: USER_ID,
				pullRequestId: PULL_REQUEST_ID,
				repositoryId: REPOSITORY_ID,
				target: {
					pullRequestMappingId: PULL_REQUEST_MAPPING_ID,
					externalNodeId: 'pull-request-node',
					externalNumber: 1,
				},
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 7,
					endLine: 9,
					anchorSha: 'anchor-sha',
					baseSha: 'base-sha',
					headSha: 'head-sha',
					lineExcerpt: 'third line',
				},
				comment: {
					nodeId: 'comment-node',
					numericId: 201n,
					author: {
						nodeId: 'actor-node',
						numericId: 7n,
						login: 'marta',
						type: 'user',
					},
					body: 'Range comment',
					htmlUrl: 'https://github.com/org/repo/pull/1#discussion_r201',
					subjectType: 'line',
					path: 'src/index.ts',
					side: 'right',
					line: 9,
					startSide,
					startLine: 7,
					commitId: 'head-sha',
					createdAt: new Date('2026-08-16T10:00:00Z'),
					updatedAt: new Date('2026-08-16T10:00:00Z'),
				},
			})
		).toBe(THREAD_ID)
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'inline',
				line: 9,
				startLine: expectedStartLine,
			})
		)
	})
})

function toQuery(condition: unknown) {
	return new PgDialect().sqlToQuery(condition as SQL)
}
