import type {
	Brand,
	PullRequestCommentId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
} from '@repo/domain'
import { isNotNull, relations, sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import {
	type GitHubActorId,
	type GitHubPullRequestMappingId,
	type GitHubWebhookDeliveryId,
	gitHubActors,
	gitHubPullRequestMappings,
	gitHubWebhookDeliveries,
} from './github-sync.schema'
import {
	pullRequestReviewerRequests,
	pullRequestReviews,
} from './pull-request-reviews.schema'
import {
	pullRequestComments,
	pullRequestThreadSideEnum,
	pullRequestThreads,
} from './pull-request-threads.schema'

export type GitHubPullRequestThreadMappingId = Brand<
	string,
	'github_pull_request_thread_mapping_id'
>
export type GitHubPullRequestCommentMappingId = Brand<
	string,
	'github_pull_request_comment_mapping_id'
>
export type GitHubPullRequestReviewMappingId = Brand<
	string,
	'github_pull_request_review_mapping_id'
>
export type GitHubPullRequestReviewerRequestMappingId = Brand<
	string,
	'github_pull_request_reviewer_request_mapping_id'
>

export const gitHubPullRequestCommentKindEnum = pgEnum(
	'github_pull_request_comment_kind',
	['issue', 'review']
)

export const gitHubPullRequestCommentSubjectTypeEnum = pgEnum(
	'github_pull_request_comment_subject_type',
	['line', 'file']
)

export const gitHubPullRequestReviewerTargetKindEnum = pgEnum(
	'github_pull_request_reviewer_target_kind',
	['user', 'team']
)

export const gitHubPullRequestThreadMappings = pgTable(
	'github_pull_request_thread_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestThreadMappingId>(),
		pullRequestMappingId: uuid('pull_request_mapping_id')
			.notNull()
			.$type<GitHubPullRequestMappingId>()
			.references(() => gitHubPullRequestMappings.id, { onDelete: 'cascade' }),
		pullRequestThreadId: uuid('pull_request_thread_id')
			.$type<PullRequestThreadId>()
			.references(() => pullRequestThreads.id, { onDelete: 'set null' }),
		externalNodeId: text('external_node_id'),
		rootCommentNodeId: text('root_comment_node_id'),
		resolvedByActorId: uuid('resolved_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		providerResolved: boolean('provider_resolved').default(false).notNull(),
		providerResolvedAt: timestamp('provider_resolved_at'),
		providerOutdated: boolean('provider_outdated').default(false).notNull(),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		lastSeenSyncVersion: bigint('last_seen_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		deletedAt: timestamp('deleted_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		uniqueIndex('github_pull_request_thread_mappings_node_id_unique')
			.on(table.externalNodeId)
			.where(isNotNull(table.externalNodeId)),
		uniqueIndex('github_pull_request_thread_mappings_root_comment_unique')
			.on(table.rootCommentNodeId)
			.where(isNotNull(table.rootCommentNodeId)),
		uniqueIndex('github_pull_request_thread_mappings_thread_id_unique')
			.on(table.pullRequestThreadId)
			.where(isNotNull(table.pullRequestThreadId)),
		index('github_pull_request_thread_mappings_pull_request_mapping_idx').on(
			table.pullRequestMappingId
		),
		index('github_pull_request_thread_mappings_resolved_by_actor_idx').on(
			table.resolvedByActorId
		),
		check(
			'github_pull_request_thread_mappings_identity_check',
			sql`${table.externalNodeId} is not null or ${table.rootCommentNodeId} is not null`
		),
		check(
			'github_pull_request_thread_mappings_resolution_check',
			sql`(${table.providerResolved} = false) = (${table.providerResolvedAt} is null)`
		),
	]
)

export const gitHubPullRequestCommentMappings = pgTable(
	'github_pull_request_comment_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestCommentMappingId>(),
		pullRequestMappingId: uuid('pull_request_mapping_id')
			.notNull()
			.$type<GitHubPullRequestMappingId>()
			.references(() => gitHubPullRequestMappings.id, { onDelete: 'cascade' }),
		threadMappingId: uuid('thread_mapping_id')
			.$type<GitHubPullRequestThreadMappingId>()
			.references(() => gitHubPullRequestThreadMappings.id, {
				onDelete: 'cascade',
			}),
		pullRequestCommentId: uuid('pull_request_comment_id')
			.$type<PullRequestCommentId>()
			.references(() => pullRequestComments.id, { onDelete: 'set null' }),
		kind: gitHubPullRequestCommentKindEnum('kind').notNull(),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', {
			mode: 'bigint',
		}).notNull(),
		authorActorId: uuid('author_actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		parentExternalNodeId: text('parent_external_node_id'),
		parentExternalNumericId: bigint('parent_external_numeric_id', {
			mode: 'bigint',
		}),
		reviewExternalNodeId: text('review_external_node_id'),
		reviewExternalNumericId: bigint('review_external_numeric_id', {
			mode: 'bigint',
		}),
		htmlUrl: text('html_url').notNull(),
		subjectType: gitHubPullRequestCommentSubjectTypeEnum('subject_type'),
		path: text('path'),
		side: pullRequestThreadSideEnum('side'),
		line: integer('line'),
		originalLine: integer('original_line'),
		startSide: pullRequestThreadSideEnum('start_side'),
		startLine: integer('start_line'),
		originalStartLine: integer('original_start_line'),
		commitId: text('commit_id'),
		originalCommitId: text('original_commit_id'),
		diffHunk: text('diff_hunk'),
		providerCreatedAt: timestamp('provider_created_at').notNull(),
		providerUpdatedAt: timestamp('provider_updated_at').notNull(),
		providerDeletedAt: timestamp('provider_deleted_at'),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		lastSeenSyncVersion: bigint('last_seen_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('github_pull_request_comment_mappings_numeric_id_unique').on(
			table.kind,
			table.externalNumericId
		),
		uniqueIndex('github_pull_request_comment_mappings_comment_id_unique')
			.on(table.pullRequestCommentId)
			.where(isNotNull(table.pullRequestCommentId)),
		index('github_pull_request_comment_mappings_pull_request_mapping_idx').on(
			table.pullRequestMappingId
		),
		index('github_pull_request_comment_mappings_thread_mapping_idx').on(
			table.threadMappingId
		),
		index('github_pull_request_comment_mappings_author_actor_idx').on(
			table.authorActorId
		),
		index('github_pull_request_comment_mappings_parent_node_id_idx').on(
			table.parentExternalNodeId
		),
	]
)

export const gitHubPullRequestReviewMappings = pgTable(
	'github_pull_request_review_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestReviewMappingId>(),
		pullRequestMappingId: uuid('pull_request_mapping_id')
			.notNull()
			.$type<GitHubPullRequestMappingId>()
			.references(() => gitHubPullRequestMappings.id, { onDelete: 'cascade' }),
		pullRequestReviewId: uuid('pull_request_review_id')
			.$type<PullRequestReviewId>()
			.references(() => pullRequestReviews.id, { onDelete: 'set null' }),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' })
			.notNull()
			.unique(),
		reviewerActorId: uuid('reviewer_actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		htmlUrl: text('html_url').notNull(),
		commitId: text('commit_id'),
		dismissedByActorId: uuid('dismissed_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		providerSubmittedAt: timestamp('provider_submitted_at').notNull(),
		providerDismissedAt: timestamp('provider_dismissed_at'),
		providerDeletedAt: timestamp('provider_deleted_at'),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		lastSeenSyncVersion: bigint('last_seen_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		uniqueIndex('github_pull_request_review_mappings_review_id_unique')
			.on(table.pullRequestReviewId)
			.where(isNotNull(table.pullRequestReviewId)),
		index('github_pull_request_review_mappings_pull_request_mapping_idx').on(
			table.pullRequestMappingId
		),
		index('github_pull_request_review_mappings_reviewer_actor_idx').on(
			table.reviewerActorId
		),
		check(
			'github_pull_request_review_mappings_dismissal_check',
			sql`${table.providerDismissedAt} is not null or ${table.dismissedByActorId} is null`
		),
	]
)

export const gitHubPullRequestReviewerRequestMappings = pgTable(
	'github_pull_request_reviewer_request_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestReviewerRequestMappingId>(),
		pullRequestMappingId: uuid('pull_request_mapping_id')
			.notNull()
			.$type<GitHubPullRequestMappingId>()
			.references(() => gitHubPullRequestMappings.id, { onDelete: 'cascade' }),
		pullRequestReviewerRequestId: uuid('pull_request_reviewer_request_id')
			.$type<PullRequestReviewerRequestId>()
			.references(() => pullRequestReviewerRequests.id, {
				onDelete: 'set null',
			}),
		externalKey: text('external_key').notNull(),
		targetKind:
			gitHubPullRequestReviewerTargetKindEnum('target_kind').notNull(),
		targetNodeId: text('target_node_id').notNull(),
		targetNumericId: bigint('target_numeric_id', { mode: 'bigint' }),
		targetActorId: uuid('target_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		teamSlug: text('team_slug'),
		teamName: text('team_name'),
		teamAvatarUrl: text('team_avatar_url'),
		teamHtmlUrl: text('team_html_url'),
		requestedByActorId: uuid('requested_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		removedByActorId: uuid('removed_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		active: boolean('active').default(true).notNull(),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		lastSeenSyncVersion: bigint('last_seen_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('github_pull_request_reviewer_request_external_key_unique').on(
			table.externalKey
		),
		uniqueIndex('github_pull_request_reviewer_request_active_target_unique')
			.on(table.pullRequestMappingId, table.targetKind, table.targetNodeId)
			.where(sql`${table.active} = true`),
		uniqueIndex('github_pull_request_reviewer_request_request_id_unique')
			.on(table.pullRequestReviewerRequestId)
			.where(isNotNull(table.pullRequestReviewerRequestId)),
		index('github_pull_request_reviewer_request_mapping_idx').on(
			table.pullRequestMappingId
		),
		index('github_pull_request_reviewer_request_target_actor_idx').on(
			table.targetActorId
		),
		check(
			'github_pull_request_reviewer_request_target_check',
			sql`(
				(${table.targetKind}::text = 'user' and ${table.targetActorId} is not null and ${table.teamSlug} is null)
				or (${table.targetKind}::text = 'team' and ${table.targetActorId} is null and ${table.teamSlug} is not null)
			)`
		),
	]
)

export type GitHubPullRequestThreadMapping =
	typeof gitHubPullRequestThreadMappings.$inferSelect
export type NewGitHubPullRequestThreadMapping =
	typeof gitHubPullRequestThreadMappings.$inferInsert
export type GitHubPullRequestCommentMapping =
	typeof gitHubPullRequestCommentMappings.$inferSelect
export type NewGitHubPullRequestCommentMapping =
	typeof gitHubPullRequestCommentMappings.$inferInsert
export type GitHubPullRequestReviewMapping =
	typeof gitHubPullRequestReviewMappings.$inferSelect
export type NewGitHubPullRequestReviewMapping =
	typeof gitHubPullRequestReviewMappings.$inferInsert
export type GitHubPullRequestReviewerRequestMapping =
	typeof gitHubPullRequestReviewerRequestMappings.$inferSelect
export type NewGitHubPullRequestReviewerRequestMapping =
	typeof gitHubPullRequestReviewerRequestMappings.$inferInsert

export const gitHubPullRequestThreadMappingRelations = relations(
	gitHubPullRequestThreadMappings,
	({ many, one }) => ({
		pullRequestMapping: one(gitHubPullRequestMappings, {
			fields: [gitHubPullRequestThreadMappings.pullRequestMappingId],
			references: [gitHubPullRequestMappings.id],
		}),
		thread: one(pullRequestThreads, {
			fields: [gitHubPullRequestThreadMappings.pullRequestThreadId],
			references: [pullRequestThreads.id],
		}),
		resolvedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestThreadMappings.resolvedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_thread_resolver',
		}),
		commentMappings: many(gitHubPullRequestCommentMappings),
	})
)

export const gitHubPullRequestCommentMappingRelations = relations(
	gitHubPullRequestCommentMappings,
	({ one }) => ({
		pullRequestMapping: one(gitHubPullRequestMappings, {
			fields: [gitHubPullRequestCommentMappings.pullRequestMappingId],
			references: [gitHubPullRequestMappings.id],
		}),
		threadMapping: one(gitHubPullRequestThreadMappings, {
			fields: [gitHubPullRequestCommentMappings.threadMappingId],
			references: [gitHubPullRequestThreadMappings.id],
		}),
		comment: one(pullRequestComments, {
			fields: [gitHubPullRequestCommentMappings.pullRequestCommentId],
			references: [pullRequestComments.id],
		}),
		authorActor: one(gitHubActors, {
			fields: [gitHubPullRequestCommentMappings.authorActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_comment_author',
		}),
	})
)

export const gitHubPullRequestReviewMappingRelations = relations(
	gitHubPullRequestReviewMappings,
	({ one }) => ({
		pullRequestMapping: one(gitHubPullRequestMappings, {
			fields: [gitHubPullRequestReviewMappings.pullRequestMappingId],
			references: [gitHubPullRequestMappings.id],
		}),
		review: one(pullRequestReviews, {
			fields: [gitHubPullRequestReviewMappings.pullRequestReviewId],
			references: [pullRequestReviews.id],
		}),
		reviewerActor: one(gitHubActors, {
			fields: [gitHubPullRequestReviewMappings.reviewerActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_review_reviewer',
		}),
		dismissedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestReviewMappings.dismissedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_review_dismisser',
		}),
	})
)

export const gitHubPullRequestReviewerRequestMappingRelations = relations(
	gitHubPullRequestReviewerRequestMappings,
	({ one }) => ({
		pullRequestMapping: one(gitHubPullRequestMappings, {
			fields: [gitHubPullRequestReviewerRequestMappings.pullRequestMappingId],
			references: [gitHubPullRequestMappings.id],
		}),
		reviewerRequest: one(pullRequestReviewerRequests, {
			fields: [
				gitHubPullRequestReviewerRequestMappings.pullRequestReviewerRequestId,
			],
			references: [pullRequestReviewerRequests.id],
		}),
		targetActor: one(gitHubActors, {
			fields: [gitHubPullRequestReviewerRequestMappings.targetActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_reviewer_request_target',
		}),
		requestedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestReviewerRequestMappings.requestedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_reviewer_request_requester',
		}),
		removedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestReviewerRequestMappings.removedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_reviewer_request_remover',
		}),
	})
)
