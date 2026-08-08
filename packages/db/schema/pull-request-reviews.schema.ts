import type {
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	UserId,
} from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	check,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { pullRequestProviderEnum, pullRequests } from './pull-requests.schema'

export const pullRequestReviewStateEnum = pgEnum('pull_request_review_state', [
	'pending',
	'submitted',
])

export const pullRequestReviewOutcomeEnum = pgEnum(
	'pull_request_review_outcome',
	['approve', 'request_changes', 'comment']
)

export const pullRequestReviews = pgTable(
	'pull_request_reviews',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<PullRequestReviewId>(),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		reviewerUserId: uuid('reviewer_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		state: pullRequestReviewStateEnum('state').default('pending').notNull(),
		outcome: pullRequestReviewOutcomeEnum('outcome'),
		headSha: text('head_sha').notNull(),
		body: text('body').default('').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		submittedAt: timestamp('submitted_at'),
	},
	table => [
		uniqueIndex('pull_request_reviews_pending_reviewer_unique')
			.on(table.pullRequestId, table.reviewerUserId)
			.where(sql`${table.state} = 'pending'`),
		index('pull_request_reviews_pull_request_state_idx').on(
			table.pullRequestId,
			table.state
		),
		index('pull_request_reviews_pull_request_reviewer_submitted_at_idx').on(
			table.pullRequestId,
			table.reviewerUserId,
			table.submittedAt
		),
		check(
			'pull_request_reviews_reviewer_check',
			sql`${table.provider}::text = 'github' or ${table.reviewerUserId} is not null`
		),
		check(
			'pull_request_reviews_state_check',
			sql`(
				(${table.state}::text = 'pending' and ${table.outcome} is null and ${table.submittedAt} is null)
				or (${table.state}::text = 'submitted' and ${table.outcome} is not null and ${table.submittedAt} is not null)
			)`
		),
	]
)

export const pullRequestReviewerRequests = pgTable(
	'pull_request_reviewer_requests',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<PullRequestReviewerRequestId>(),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		reviewerUserId: uuid('reviewer_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		requestedByUserId: uuid('requested_by_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		fulfilledByReviewId: uuid('fulfilled_by_review_id')
			.$type<PullRequestReviewId>()
			.references(() => pullRequestReviews.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		removedAt: timestamp('removed_at'),
		removedByUserId: uuid('removed_by_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
	},
	table => [
		uniqueIndex('pull_request_reviewer_requests_active_reviewer_unique')
			.on(table.pullRequestId, table.reviewerUserId)
			.where(
				sql`${table.removedAt} is null and ${table.fulfilledByReviewId} is null`
			),
		index('pull_request_reviewer_requests_pull_request_created_at_idx').on(
			table.pullRequestId,
			table.createdAt
		),
		check(
			'pull_request_reviewer_requests_actors_check',
			sql`${table.provider}::text = 'github' or (${table.reviewerUserId} is not null and ${table.requestedByUserId} is not null)`
		),
		check(
			'pull_request_reviewer_requests_removal_check',
			sql`(
				(${table.removedAt} is null and ${table.removedByUserId} is null)
				or (${table.removedAt} is not null and (${table.provider}::text = 'github' or ${table.removedByUserId} is not null))
			)`
		),
	]
)

export type PullRequestReview = typeof pullRequestReviews.$inferSelect
export type NewPullRequestReview = typeof pullRequestReviews.$inferInsert
export type PullRequestReviewerRequest =
	typeof pullRequestReviewerRequests.$inferSelect
export type NewPullRequestReviewerRequest =
	typeof pullRequestReviewerRequests.$inferInsert

export const pullRequestReviewRelations = relations(
	pullRequestReviews,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestReviews.pullRequestId],
			references: [pullRequests.id],
		}),
		reviewerUser: one(user, {
			fields: [pullRequestReviews.reviewerUserId],
			references: [user.id],
			relationName: 'pull_request_review_reviewer',
		}),
	})
)

export const pullRequestReviewerRequestRelations = relations(
	pullRequestReviewerRequests,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestReviewerRequests.pullRequestId],
			references: [pullRequests.id],
		}),
		reviewerUser: one(user, {
			fields: [pullRequestReviewerRequests.reviewerUserId],
			references: [user.id],
			relationName: 'pull_request_reviewer_request_reviewer',
		}),
		requestedByUser: one(user, {
			fields: [pullRequestReviewerRequests.requestedByUserId],
			references: [user.id],
			relationName: 'pull_request_reviewer_request_requester',
		}),
		removedByUser: one(user, {
			fields: [pullRequestReviewerRequests.removedByUserId],
			references: [user.id],
			relationName: 'pull_request_reviewer_request_remover',
		}),
		fulfilledByReview: one(pullRequestReviews, {
			fields: [pullRequestReviewerRequests.fulfilledByReviewId],
			references: [pullRequestReviews.id],
		}),
	})
)
