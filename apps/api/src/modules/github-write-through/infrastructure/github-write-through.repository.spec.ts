import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubPullRequestThreadMappingId } from '@repo/db'
import type { PullRequestThreadId } from '@repo/domain'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { GitHubWriteThroughRepository } from './github-write-through.repository'

const THREAD_ID = '00000000-0000-4000-8000-000000000001' as PullRequestThreadId
const THREAD_MAPPING_ID =
	'00000000-0000-4000-8000-000000000002' as GitHubPullRequestThreadMappingId

describe(GitHubWriteThroughRepository.name, () => {
	let moduleRef: TestingModule
	let repository: GitHubWriteThroughRepository
	const conditions: unknown[] = []
	const pages: unknown[][] = []

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
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubWriteThroughRepository,
				{ provide: Database, useValue: { select } },
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
})

function toQuery(condition: unknown) {
	return new PgDialect().sqlToQuery(condition as SQL)
}
