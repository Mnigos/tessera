import type {
	Brand,
	CheckId,
	CheckObservationId,
	RepositoryId,
} from '@repo/domain'
import { isNotNull, relations } from 'drizzle-orm'
import {
	bigint,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { checkObservations, checks } from './checks.schema'
import {
	type GitHubActorId,
	type GitHubWebhookDeliveryId,
	gitHubActors,
	gitHubWebhookDeliveries,
} from './github-sync.schema'
import { repositories } from './repositories.schema'

export type GitHubCheckSuiteMappingId = Brand<
	string,
	'github_check_suite_mapping_id'
>
export type GitHubCheckRunMappingId = Brand<
	string,
	'github_check_run_mapping_id'
>
export type GitHubCommitStatusMappingId = Brand<
	string,
	'github_commit_status_mapping_id'
>

/**
 * The suite a set of runs was reported under. Tessera projects no native row for
 * a suite — it is provider grouping, not a result — so this table exists to keep
 * run identity resolvable and to snapshot which GitHub App produced the runs.
 *
 * Every mapping table here follows one rule: the repository owns the rows and
 * takes them with it, and nothing else may rewrite what they record. The links
 * into the native ledger and back to the delivery that announced a result are
 * `no action` rather than `set null`, so a deletion that would orphan provenance
 * raises instead of quietly emptying the columns that prove where a result came
 * from.
 */
export const gitHubCheckSuiteMappings = pgTable(
	'github_check_suite_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubCheckSuiteMappingId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' })
			.notNull()
			.unique(),
		headSha: text('head_sha').notNull(),
		rawStatus: text('raw_status'),
		rawConclusion: text('raw_conclusion'),
		// A GitHub App is not a person and never becomes a `github_actor`; the
		// identity is snapshotted here so a renamed or uninstalled app still reads
		// back the way it did when the result was recorded.
		appExternalNumericId: bigint('app_external_numeric_id', { mode: 'bigint' }),
		appExternalNodeId: text('app_external_node_id'),
		appSlug: text('app_slug'),
		appName: text('app_name'),
		appHtmlUrl: text('app_html_url'),
		providerCreatedAt: timestamp('provider_created_at'),
		providerUpdatedAt: timestamp('provider_updated_at'),
		/**
		 * When the suite stopped appearing in a complete provider snapshot. GitHub
		 * prunes old suites, so absence is never deletion evidence and never
		 * removes the native observations projected from it.
		 */
		providerMissingAt: timestamp('provider_missing_at'),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'no action' }),
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
		index('github_check_suite_mappings_repository_head_sha_idx').on(
			table.repositoryId,
			table.headSha
		),
	]
)

export const gitHubCheckRunMappings = pgTable(
	'github_check_run_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubCheckRunMappingId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		checkSuiteMappingId: uuid('check_suite_mapping_id')
			.$type<GitHubCheckSuiteMappingId>()
			.references(() => gitHubCheckSuiteMappings.id, { onDelete: 'no action' }),
		checkId: uuid('check_id')
			.$type<CheckId>()
			.references(() => checks.id, { onDelete: 'no action' }),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' })
			.notNull()
			.unique(),
		name: text('name').notNull(),
		headSha: text('head_sha').notNull(),
		/** The provider's own correlation key, opaque to Tessera. */
		externalId: text('external_id'),
		detailsUrl: text('details_url'),
		htmlUrl: text('html_url'),
		appExternalNumericId: bigint('app_external_numeric_id', { mode: 'bigint' }),
		appExternalNodeId: text('app_external_node_id'),
		appSlug: text('app_slug'),
		appName: text('app_name'),
		appHtmlUrl: text('app_html_url'),
		providerStartedAt: timestamp('provider_started_at'),
		providerCompletedAt: timestamp('provider_completed_at'),
		providerMissingAt: timestamp('provider_missing_at'),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'no action' }),
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
		uniqueIndex('github_check_run_mappings_check_id_unique')
			.on(table.checkId)
			.where(isNotNull(table.checkId)),
		index('github_check_run_mappings_repository_head_sha_idx').on(
			table.repositoryId,
			table.headSha
		),
		index('github_check_run_mappings_check_suite_mapping_idx').on(
			table.checkSuiteMappingId
		),
	]
)

/**
 * One posted commit status. Statuses share a native check per context, so the
 * mapping points at the observation it produced as well as the stream it joined.
 */
export const gitHubCommitStatusMappings = pgTable(
	'github_commit_status_mappings',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<GitHubCommitStatusMappingId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		checkId: uuid('check_id')
			.$type<CheckId>()
			.references(() => checks.id, { onDelete: 'no action' }),
		checkObservationId: uuid('check_observation_id')
			.$type<CheckObservationId>()
			.references(() => checkObservations.id, { onDelete: 'no action' }),
		externalNodeId: text('external_node_id').notNull().unique(),
		externalNumericId: bigint('external_numeric_id', { mode: 'bigint' })
			.notNull()
			.unique(),
		sha: text('sha').notNull(),
		context: text('context').notNull(),
		rawState: text('raw_state').notNull(),
		targetUrl: text('target_url'),
		description: text('description'),
		/** Statuses are posted by a user or a bot account, which is a real actor. */
		creatorActorId: uuid('creator_actor_id')
			.$type<GitHubActorId>()
			.references(() => gitHubActors.id, { onDelete: 'restrict' }),
		providerCreatedAt: timestamp('provider_created_at'),
		providerUpdatedAt: timestamp('provider_updated_at'),
		providerMissingAt: timestamp('provider_missing_at'),
		deliveryId: uuid('delivery_id')
			.$type<GitHubWebhookDeliveryId>()
			.references(() => gitHubWebhookDeliveries.id, { onDelete: 'no action' }),
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
		uniqueIndex('github_commit_status_mappings_observation_id_unique')
			.on(table.checkObservationId)
			.where(isNotNull(table.checkObservationId)),
		index('github_commit_status_mappings_repository_sha_context_idx').on(
			table.repositoryId,
			table.sha,
			table.context
		),
		index('github_commit_status_mappings_creator_actor_idx').on(
			table.creatorActorId
		),
	]
)

export type GitHubCheckSuiteMapping =
	typeof gitHubCheckSuiteMappings.$inferSelect
export type NewGitHubCheckSuiteMapping =
	typeof gitHubCheckSuiteMappings.$inferInsert
export type GitHubCheckRunMapping = typeof gitHubCheckRunMappings.$inferSelect
export type NewGitHubCheckRunMapping =
	typeof gitHubCheckRunMappings.$inferInsert
export type GitHubCommitStatusMapping =
	typeof gitHubCommitStatusMappings.$inferSelect
export type NewGitHubCommitStatusMapping =
	typeof gitHubCommitStatusMappings.$inferInsert

export const gitHubCheckSuiteMappingRelations = relations(
	gitHubCheckSuiteMappings,
	({ many, one }) => ({
		repository: one(repositories, {
			fields: [gitHubCheckSuiteMappings.repositoryId],
			references: [repositories.id],
		}),
		runMappings: many(gitHubCheckRunMappings),
	})
)

export const gitHubCheckRunMappingRelations = relations(
	gitHubCheckRunMappings,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubCheckRunMappings.repositoryId],
			references: [repositories.id],
		}),
		suiteMapping: one(gitHubCheckSuiteMappings, {
			fields: [gitHubCheckRunMappings.checkSuiteMappingId],
			references: [gitHubCheckSuiteMappings.id],
		}),
		check: one(checks, {
			fields: [gitHubCheckRunMappings.checkId],
			references: [checks.id],
		}),
	})
)

export const gitHubCommitStatusMappingRelations = relations(
	gitHubCommitStatusMappings,
	({ one }) => ({
		repository: one(repositories, {
			fields: [gitHubCommitStatusMappings.repositoryId],
			references: [repositories.id],
		}),
		check: one(checks, {
			fields: [gitHubCommitStatusMappings.checkId],
			references: [checks.id],
		}),
		observation: one(checkObservations, {
			fields: [gitHubCommitStatusMappings.checkObservationId],
			references: [checkObservations.id],
		}),
		creatorActor: one(gitHubActors, {
			fields: [gitHubCommitStatusMappings.creatorActorId],
			references: [gitHubActors.id],
			relationName: 'github_commit_status_creator',
		}),
	})
)
