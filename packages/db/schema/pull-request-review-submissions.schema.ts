import type {
	Brand,
	PullRequestId,
	PullRequestReviewId,
	UserId,
} from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	bigint,
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
import { pullRequests } from './pull-requests.schema'

export type PullRequestReviewSubmissionId = Brand<
	string,
	'pull_request_review_submission_id'
>

export const pullRequestReviewSubmissionStateEnum = pgEnum(
	'pull_request_review_submission_state',
	['preparing', 'sent', 'reconciled', 'adopted', 'failed']
)

/**
 * Ledger for a batched review handed to GitHub. `pulls.createReview` carries no
 * idempotency key, so a lost response leaves the caller unable to tell whether
 * the review was posted; the row is what a retry reads instead of posting again.
 */
export const pullRequestReviewSubmissions = pgTable(
	'pull_request_review_submissions',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<PullRequestReviewSubmissionId>(),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		reviewId: uuid('review_id')
			.$type<PullRequestReviewId>()
			.references(() => pullRequestReviews.id, { onDelete: 'set null' }),
		actorUserId: uuid('actor_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		idempotencyKey: text('idempotency_key').notNull().unique(),
		state: pullRequestReviewSubmissionStateEnum('state')
			.default('preparing')
			.notNull(),
		expectedHeadSha: text('expected_head_sha').notNull(),
		commentCount: integer('comment_count').default(0).notNull(),
		externalReviewNodeId: text('external_review_node_id'),
		externalReviewNumericId: bigint('external_review_numeric_id', {
			mode: 'bigint',
		}),
		attempts: integer('attempts').default(1).notNull(),
		lastErrorCode: text('last_error_code'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('pull_request_review_submissions_pull_request_actor_idx').on(
			table.pullRequestId,
			table.actorUserId,
			table.createdAt
		),
		index('pull_request_review_submissions_review_idx').on(table.reviewId),
	]
)

export type PullRequestReviewSubmission =
	typeof pullRequestReviewSubmissions.$inferSelect
export type NewPullRequestReviewSubmission =
	typeof pullRequestReviewSubmissions.$inferInsert

export const pullRequestReviewSubmissionRelations = relations(
	pullRequestReviewSubmissions,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestReviewSubmissions.pullRequestId],
			references: [pullRequests.id],
		}),
		review: one(pullRequestReviews, {
			fields: [pullRequestReviewSubmissions.reviewId],
			references: [pullRequestReviews.id],
		}),
		actor: one(user, {
			fields: [pullRequestReviewSubmissions.actorUserId],
			references: [user.id],
		}),
	})
)
