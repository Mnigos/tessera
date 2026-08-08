import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	UserId,
} from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { pullRequestReviews } from './pull-request-reviews.schema'
import { pullRequestProviderEnum, pullRequests } from './pull-requests.schema'

export const pullRequestThreadKindEnum = pgEnum('pull_request_thread_kind', [
	'top_level',
	'inline',
])

export const pullRequestThreadSideEnum = pgEnum('pull_request_thread_side', [
	'left',
	'right',
])

export const pullRequestCommentStateEnum = pgEnum(
	'pull_request_comment_state',
	['published', 'pending']
)

export const pullRequestThreads = pgTable(
	'pull_request_threads',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<PullRequestThreadId>(),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		kind: pullRequestThreadKindEnum('kind').notNull(),
		path: text('path'),
		side: pullRequestThreadSideEnum('side'),
		line: integer('line'),
		anchorSha: text('anchor_sha'),
		baseSha: text('base_sha'),
		headSha: text('head_sha'),
		lineExcerpt: text('line_excerpt'),
		resolvedAt: timestamp('resolved_at'),
		resolvedByUserId: uuid('resolved_by_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('pull_request_threads_pull_request_created_at_idx').on(
			table.pullRequestId,
			table.createdAt
		),
		index('pull_request_threads_pull_request_path_idx').on(
			table.pullRequestId,
			table.path
		),
		check(
			'pull_request_threads_anchor_check',
			sql`(
				(${table.kind}::text = 'top_level' and ${table.path} is null and ${table.side} is null and ${table.line} is null and ${table.anchorSha} is null and ${table.baseSha} is null and ${table.headSha} is null and ${table.lineExcerpt} is null)
				or (${table.kind}::text = 'inline' and ${table.path} is not null and ${table.side} is not null and ${table.line} is not null and ${table.line} > 0 and ${table.anchorSha} is not null and ${table.baseSha} is not null and ${table.headSha} is not null and ${table.lineExcerpt} is not null)
			)`
		),
		check(
			'pull_request_threads_resolution_check',
			sql`(
				(${table.resolvedAt} is null and ${table.resolvedByUserId} is null)
				or (${table.resolvedAt} is not null and (${table.provider}::text = 'github' or ${table.resolvedByUserId} is not null))
			)`
		),
	]
)

export const pullRequestComments = pgTable(
	'pull_request_comments',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<PullRequestCommentId>(),
		threadId: uuid('thread_id')
			.notNull()
			.$type<PullRequestThreadId>()
			.references(() => pullRequestThreads.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		authorUserId: uuid('author_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		body: text('body').notNull(),
		state: pullRequestCommentStateEnum('state').default('published').notNull(),
		reviewId: uuid('review_id')
			.$type<PullRequestReviewId>()
			.references(() => pullRequestReviews.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		editedAt: timestamp('edited_at'),
	},
	table => [
		index('pull_request_comments_thread_created_at_idx').on(
			table.threadId,
			table.createdAt
		),
		index('pull_request_comments_review_id_idx').on(table.reviewId),
		check(
			'pull_request_comments_body_check',
			sql`length(btrim(${table.body})) > 0`
		),
		check(
			'pull_request_comments_author_check',
			sql`${table.provider}::text = 'github' or ${table.authorUserId} is not null`
		),
		check(
			'pull_request_comments_pending_review_check',
			sql`${table.state}::text <> 'pending' or ${table.reviewId} is not null`
		),
	]
)

export type PullRequestThread = typeof pullRequestThreads.$inferSelect
export type NewPullRequestThread = typeof pullRequestThreads.$inferInsert
export type PullRequestComment = typeof pullRequestComments.$inferSelect
export type NewPullRequestComment = typeof pullRequestComments.$inferInsert

export const pullRequestThreadRelations = relations(
	pullRequestThreads,
	({ many, one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestThreads.pullRequestId],
			references: [pullRequests.id],
		}),
		resolvedByUser: one(user, {
			fields: [pullRequestThreads.resolvedByUserId],
			references: [user.id],
			relationName: 'pull_request_thread_resolver',
		}),
		comments: many(pullRequestComments),
	})
)

export const pullRequestCommentRelations = relations(
	pullRequestComments,
	({ one }) => ({
		thread: one(pullRequestThreads, {
			fields: [pullRequestComments.threadId],
			references: [pullRequestThreads.id],
		}),
		authorUser: one(user, {
			fields: [pullRequestComments.authorUserId],
			references: [user.id],
			relationName: 'pull_request_comment_author',
		}),
		review: one(pullRequestReviews, {
			fields: [pullRequestComments.reviewId],
			references: [pullRequestReviews.id],
		}),
	})
)
