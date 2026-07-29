import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
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
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export const pullRequestStateEnum = pgEnum('pull_request_state', [
	'open',
	'closed',
	'merged',
])

export const pullRequestProviderEnum = pgEnum('pull_request_provider', [
	'tessera',
	'github',
])

export const pullRequestEventTypeEnum = pgEnum('pull_request_event_type', [
	'opened',
	'edited',
	'closed',
	'reopened',
	'merged',
	'synchronized',
	'retargeted',
	'converted_to_draft',
	'ready_for_review',
	'assigned',
	'review_requested',
	'labeled',
])

export const repositoryPullRequestCounters = pgTable(
	'repository_pull_request_counters',
	{
		repositoryId: uuid('repository_id')
			.primaryKey()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		nextNumber: integer('next_number').default(1).notNull(),
	},
	table => [
		check(
			'repository_pull_request_counters_next_number_check',
			sql`${table.nextNumber} > 0`
		),
	]
)

export const pullRequests = pgTable(
	'pull_requests',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<PullRequestId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		number: integer('number').notNull(),
		authorUserId: uuid('author_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		sourceBranch: text('source_branch').notNull(),
		targetBranch: text('target_branch').notNull(),
		openingBaseSha: text('opening_base_sha').notNull(),
		openingHeadSha: text('opening_head_sha').notNull(),
		title: text('title').notNull(),
		body: text('body').default('').notNull(),
		state: pullRequestStateEnum('state').default('open').notNull(),
		mergeCommitSha: text('merge_commit_sha'),
		mergeActorUserId: uuid('merge_actor_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		closedAt: timestamp('closed_at'),
		mergedAt: timestamp('merged_at'),
	},
	table => [
		unique('pull_requests_repository_number_unique').on(
			table.repositoryId,
			table.number
		),
		uniqueIndex('pull_requests_open_branch_pair_unique')
			.on(table.repositoryId, table.sourceBranch, table.targetBranch)
			.where(sql`${table.state} = 'open' and ${table.provider} = 'tessera'`),
		index('pull_requests_repository_state_number_idx').on(
			table.repositoryId,
			table.state,
			table.number
		),
		index('pull_requests_author_user_id_idx').on(table.authorUserId),
		check('pull_requests_number_check', sql`${table.number} > 0`),
		check(
			'pull_requests_distinct_branches_check',
			sql`${table.sourceBranch} <> ${table.targetBranch}`
		),
		check(
			'pull_requests_lifecycle_state_check',
			sql`(
				(${table.state}::text = 'open' and ${table.closedAt} is null and ${table.mergedAt} is null and ${table.mergeCommitSha} is null and ${table.mergeActorUserId} is null)
				or (${table.state}::text = 'closed' and ${table.closedAt} is not null and ${table.mergedAt} is null and ${table.mergeCommitSha} is null and ${table.mergeActorUserId} is null)
				or (${table.state}::text = 'merged' and ${table.closedAt} is not null and ${table.mergedAt} is not null and ${table.mergeCommitSha} is not null and (${table.provider}::text = 'github' or ${table.mergeActorUserId} is not null))
			)`
		),
		check(
			'pull_requests_author_check',
			sql`${table.provider}::text = 'github' or ${table.authorUserId} is not null`
		),
	]
)

export const pullRequestEvents = pgTable(
	'pull_request_events',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<PullRequestEventId>(),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		provider: pullRequestProviderEnum('provider').default('tessera').notNull(),
		actorUserId: uuid('actor_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		type: pullRequestEventTypeEnum('type').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('pull_request_events_pull_request_created_at_idx').on(
			table.pullRequestId,
			table.createdAt
		),
		index('pull_request_events_actor_user_id_idx').on(table.actorUserId),
		check(
			'pull_request_events_actor_check',
			sql`${table.provider}::text = 'github' or ${table.actorUserId} is not null`
		),
	]
)

export const pullRequestMergeIntents = pgTable(
	'pull_request_merge_intents',
	{
		pullRequestId: uuid('pull_request_id')
			.primaryKey()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' }),
		attemptId: uuid('attempt_id').notNull(),
		actorUserId: uuid('actor_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		startedAt: timestamp('started_at').notNull(),
	},
	table => [
		index('pull_request_merge_intents_actor_user_id_idx').on(table.actorUserId),
	]
)

export type PullRequest = typeof pullRequests.$inferSelect
export type NewPullRequest = typeof pullRequests.$inferInsert
export type PullRequestEvent = typeof pullRequestEvents.$inferSelect
export type NewPullRequestEvent = typeof pullRequestEvents.$inferInsert
export type PullRequestMergeIntent = typeof pullRequestMergeIntents.$inferSelect

export const repositoryPullRequestCounterRelations = relations(
	repositoryPullRequestCounters,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryPullRequestCounters.repositoryId],
			references: [repositories.id],
		}),
	})
)

export const pullRequestRelations = relations(
	pullRequests,
	({ many, one }) => ({
		repository: one(repositories, {
			fields: [pullRequests.repositoryId],
			references: [repositories.id],
		}),
		authorUser: one(user, {
			fields: [pullRequests.authorUserId],
			references: [user.id],
			relationName: 'pull_request_author',
		}),
		mergeActorUser: one(user, {
			fields: [pullRequests.mergeActorUserId],
			references: [user.id],
			relationName: 'pull_request_merge_actor',
		}),
		mergeIntent: one(pullRequestMergeIntents),
		events: many(pullRequestEvents),
	})
)

export const pullRequestMergeIntentRelations = relations(
	pullRequestMergeIntents,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestMergeIntents.pullRequestId],
			references: [pullRequests.id],
		}),
		actorUser: one(user, {
			fields: [pullRequestMergeIntents.actorUserId],
			references: [user.id],
			relationName: 'pull_request_merge_intent_actor',
		}),
	})
)

export const pullRequestEventRelations = relations(
	pullRequestEvents,
	({ one }) => ({
		pullRequest: one(pullRequests, {
			fields: [pullRequestEvents.pullRequestId],
			references: [pullRequests.id],
		}),
		actorUser: one(user, {
			fields: [pullRequestEvents.actorUserId],
			references: [user.id],
			relationName: 'pull_request_event_actor',
		}),
	})
)
