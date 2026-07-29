import type {
	Brand,
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { isNotNull, relations } from 'drizzle-orm'
import {
	bigint,
	boolean,
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
import { pullRequestEvents, pullRequests } from './pull-requests.schema'
import { repositories } from './repositories.schema'
import {
	type GitHubInstallationId,
	gitHubInstallations,
} from './repository-external-sources.schema'

export type GitHubActorId = Brand<string, 'github_actor_id'>
export type GitHubPullRequestMappingId = Brand<
	string,
	'github_pull_request_mapping_id'
>
export type GitHubPullRequestEventMappingId = Brand<
	string,
	'github_pull_request_event_mapping_id'
>
export type GitHubWebhookDeliveryId = Brand<
	string,
	'github_webhook_delivery_id'
>

export const gitHubActorTypeEnum = pgEnum('github_actor_type', [
	'user',
	'bot',
	'organization',
	'mannequin',
])

export const gitHubWebhookDeliveryStatusEnum = pgEnum(
	'github_webhook_delivery_status',
	['received', 'processed', 'failed', 'ignored']
)

export const gitHubActors = pgTable(
	'github_actors',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<GitHubActorId>(),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' }),
		login: text('login').notNull(),
		type: gitHubActorTypeEnum('type').notNull(),
		avatarUrl: text('avatar_url'),
		htmlUrl: text('html_url'),
		userId: uuid('user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		uniqueIndex('github_actors_external_numeric_id_unique')
			.on(table.externalNumericId)
			.where(isNotNull(table.externalNumericId)),
		index('github_actors_user_id_idx').on(table.userId),
	]
)

export const gitHubWebhookDeliveries = pgTable(
	'github_webhook_deliveries',
	{
		id: uuid('id').primaryKey().$type<GitHubWebhookDeliveryId>(),
		repositoryId: uuid('repository_id')
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		installationId: uuid('installation_id')
			.$type<GitHubInstallationId>()
			.references(() => gitHubInstallations.id, { onDelete: 'set null' }),
		eventName: text('event_name').notNull(),
		action: text('action'),
		externalRepositoryNodeId: text('external_repository_node_id'),
		externalRepositoryNumericId: bigint('external_repository_numeric_id', {
			mode: 'bigint',
		}),
		subjectNodeId: text('subject_node_id'),
		subjectNumber: integer('subject_number'),
		senderActorId: uuid('sender_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'set null' }),
		targetActorId: uuid('target_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'set null' }),
		labelNodeId: text('label_node_id'),
		labelName: text('label_name'),
		syncVersion: bigint('sync_version', { mode: 'number' }),
		status: gitHubWebhookDeliveryStatusEnum('status')
			.default('received')
			.notNull(),
		receivedAt: timestamp('received_at').defaultNow().notNull(),
		processedAt: timestamp('processed_at'),
		failedAt: timestamp('failed_at'),
		failureReason: text('failure_reason'),
	},
	table => [
		index('github_webhook_deliveries_repository_received_at_idx').on(
			table.repositoryId,
			table.receivedAt
		),
		index('github_webhook_deliveries_installation_id_idx').on(
			table.installationId
		),
		index('github_webhook_deliveries_target_actor_id_idx').on(
			table.targetActorId
		),
	]
)

export const gitHubPullRequestMappings = pgTable(
	'github_pull_request_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestMappingId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		pullRequestId: uuid('pull_request_id')
			.notNull()
			.$type<PullRequestId>()
			.references(() => pullRequests.id, { onDelete: 'cascade' })
			.unique(),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', {
			mode: 'bigint',
		}).notNull(),
		externalNumber: integer('external_number').notNull(),
		htmlUrl: text('html_url').notNull(),
		authorActorId: uuid('author_actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		mergedByActorId: uuid('merged_by_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		headRepositoryNodeId: text('head_repository_node_id'),
		baseRepositoryNodeId: text('base_repository_node_id').notNull(),
		headSha: text('head_sha').notNull(),
		baseSha: text('base_sha').notNull(),
		draft: boolean('draft').default(false).notNull(),
		providerCreatedAt: timestamp('provider_created_at').notNull(),
		providerUpdatedAt: timestamp('provider_updated_at').notNull(),
		providerClosedAt: timestamp('provider_closed_at'),
		providerMergedAt: timestamp('provider_merged_at'),
		lastSyncedAt: timestamp('last_synced_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('github_pull_request_mappings_repository_number_unique').on(
			table.repositoryId,
			table.externalNumber
		),
		unique('github_pull_request_mappings_repository_numeric_id_unique').on(
			table.repositoryId,
			table.externalNumericId
		),
		index('github_pull_request_mappings_author_actor_id_idx').on(
			table.authorActorId
		),
	]
)

export const gitHubPullRequestEventMappings = pgTable(
	'github_pull_request_event_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubPullRequestEventMappingId>(),
		pullRequestEventId: uuid('pull_request_event_id')
			.notNull()
			.$type<PullRequestEventId>()
			.references(() => pullRequestEvents.id, { onDelete: 'cascade' })
			.unique(),
		externalKey: text('external_key').notNull().unique(),
		actorId: uuid('actor_id')
			.notNull()
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('github_pull_request_event_mappings_actor_id_idx').on(table.actorId),
	]
)

export type GitHubActor = typeof gitHubActors.$inferSelect
export type NewGitHubActor = typeof gitHubActors.$inferInsert
export type GitHubWebhookDelivery = typeof gitHubWebhookDeliveries.$inferSelect
export type NewGitHubWebhookDelivery =
	typeof gitHubWebhookDeliveries.$inferInsert
export type GitHubPullRequestMapping =
	typeof gitHubPullRequestMappings.$inferSelect
export type NewGitHubPullRequestMapping =
	typeof gitHubPullRequestMappings.$inferInsert

export const gitHubActorRelations = relations(
	gitHubActors,
	({ many, one }) => ({
		user: one(user, {
			fields: [gitHubActors.userId],
			references: [user.id],
		}),
		authoredPullRequests: many(gitHubPullRequestMappings, {
			relationName: 'github_pull_request_author',
		}),
		mergedPullRequests: many(gitHubPullRequestMappings, {
			relationName: 'github_pull_request_merger',
		}),
	})
)

export const gitHubPullRequestMappingRelations = relations(
	gitHubPullRequestMappings,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubPullRequestMappings.repositoryId],
			references: [repositories.id],
		}),
		pullRequest: one(pullRequests, {
			fields: [gitHubPullRequestMappings.pullRequestId],
			references: [pullRequests.id],
		}),
		authorActor: one(gitHubActors, {
			fields: [gitHubPullRequestMappings.authorActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_author',
		}),
		mergedByActor: one(gitHubActors, {
			fields: [gitHubPullRequestMappings.mergedByActorId],
			references: [gitHubActors.id],
			relationName: 'github_pull_request_merger',
		}),
	})
)

export const gitHubWebhookDeliveryRelations = relations(
	gitHubWebhookDeliveries,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubWebhookDeliveries.repositoryId],
			references: [repositories.id],
		}),
		installation: one(gitHubInstallations, {
			fields: [gitHubWebhookDeliveries.installationId],
			references: [gitHubInstallations.id],
		}),
		senderActor: one(gitHubActors, {
			fields: [gitHubWebhookDeliveries.senderActorId],
			references: [gitHubActors.id],
			relationName: 'github_webhook_delivery_sender',
		}),
		targetActor: one(gitHubActors, {
			fields: [gitHubWebhookDeliveries.targetActorId],
			references: [gitHubActors.id],
			relationName: 'github_webhook_delivery_target',
		}),
	})
)
