import type { Brand, RepositoryId, UserId } from '@repo/domain'
import { and, eq, isNotNull, relations, type SQL, sql } from 'drizzle-orm'
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
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export type RepositoryExternalSourceId = Brand<
	string,
	'repository_external_source_id'
>
export type GitHubInstallationId = Brand<string, 'github_installation_id'>

export const gitHubInstallationTargetTypeEnum = pgEnum(
	'github_installation_target_type',
	['user', 'organization']
)

export const gitHubInstallations = pgTable(
	'github_installations',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<GitHubInstallationId>(),
		externalInstallationId: bigint('external_installation_id', {
			mode: 'bigint',
		})
			.notNull()
			.unique(),
		accountNodeId: text('account_node_id').notNull(),
		accountLogin: text('account_login').notNull(),
		targetType: gitHubInstallationTargetTypeEnum('target_type').notNull(),
		suspendedAt: timestamp('suspended_at'),
		deletedAt: timestamp('deleted_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('github_installations_account_node_id_idx').on(table.accountNodeId),
	]
)

export const repositoryExternalSourceProviderEnum = pgEnum(
	'repository_external_source_provider',
	['github']
)

export const repositoryExternalSourceMirrorModeEnum = pgEnum(
	'repository_external_source_mirror_mode',
	['imported', 'github_to_tessera', 'tessera_source']
)

export const repositoryExternalSourceSyncStatusEnum = pgEnum(
	'repository_external_source_sync_status',
	['pending', 'running', 'succeeded', 'failed', 'blocked']
)

export const repositoryExternalSourceGitHubPushBackStatusEnum = pgEnum(
	'repository_external_source_github_push_back_status',
	['idle', 'running', 'succeeded', 'failed']
)

export const repositoryExternalSources = pgTable(
	'repository_external_sources',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<RepositoryExternalSourceId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		provider: repositoryExternalSourceProviderEnum('provider')
			.notNull()
			.default('github'),
		installationId: uuid('installation_id')
			.$type<GitHubInstallationId>()
			.references(() => gitHubInstallations.id, { onDelete: 'set null' }),
		externalRepositoryNodeId: text('external_repository_node_id'),
		externalRepositoryId: bigint('external_repository_id', {
			mode: 'bigint',
		}).notNull(),
		ownerLogin: text('owner_login').notNull(),
		name: text('name').notNull(),
		fullName: text('full_name').notNull(),
		sourceUrl: text('source_url').notNull(),
		sourceDefaultBranch: text('source_default_branch').notNull(),
		mirrorMode: repositoryExternalSourceMirrorModeEnum('mirror_mode')
			.notNull()
			.default('imported'),
		syncStatus: repositoryExternalSourceSyncStatusEnum('sync_status')
			.notNull()
			.default('pending'),
		lastSyncStartedAt: timestamp('last_sync_started_at'),
		lastSyncSucceededAt: timestamp('last_sync_succeeded_at'),
		lastSyncFailedAt: timestamp('last_sync_failed_at'),
		nextSyncAt: timestamp('next_sync_at'),
		syncFailureCount: integer('sync_failure_count').default(0).notNull(),
		syncFailureCode: text('sync_failure_code'),
		syncFailureReason: text('sync_failure_reason'),
		authorityGeneration: integer('authority_generation').default(1).notNull(),
		requestedSyncVersion: bigint('requested_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		completedSyncVersion: bigint('completed_sync_version', { mode: 'number' })
			.default(0)
			.notNull(),
		pullRequestSyncCursorAt: timestamp('pull_request_sync_cursor_at'),
		syncLeaseOwner: text('sync_lease_owner'),
		syncLeaseAcquiredAt: timestamp('sync_lease_acquired_at'),
		syncLeaseExpiresAt: timestamp('sync_lease_expires_at'),
		cutoverActorUserId: uuid('cutover_actor_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'set null' }),
		cutoverAt: timestamp('cutover_at'),
		cutoverFromMirrorMode: repositoryExternalSourceMirrorModeEnum(
			'cutover_from_mirror_mode'
		),
		githubPushBackEnabled: boolean('github_push_back_enabled')
			.default(false)
			.notNull(),
		githubPushBackStatus: repositoryExternalSourceGitHubPushBackStatusEnum(
			'github_push_back_status'
		)
			.default('idle')
			.notNull(),
		githubPushBackStartedAt: timestamp('github_push_back_started_at'),
		githubPushBackSucceededAt: timestamp('github_push_back_succeeded_at'),
		githubPushBackFailedAt: timestamp('github_push_back_failed_at'),
		githubPushBackFailureReason: text('github_push_back_failure_reason'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('repository_external_sources_repository_id_unique').on(
			table.repositoryId
		),
		index('repository_external_sources_provider_external_id_idx').on(
			table.provider,
			table.externalRepositoryId
		),
		uniqueIndex('repository_external_sources_provider_node_id_unique')
			.on(table.provider, table.externalRepositoryNodeId)
			.where(isNotNull(table.externalRepositoryNodeId)),
		index('repository_external_sources_installation_id_idx').on(
			table.installationId
		),
		index('repository_external_sources_provider_full_name_idx').on(
			table.provider,
			table.fullName
		),
		index('repository_external_sources_due_sync_idx')
			.on(table.nextSyncAt)
			.where(
				and(
					eq(table.provider, 'github'),
					eq(table.mirrorMode, 'github_to_tessera'),
					isNotNull(table.nextSyncAt)
				) as SQL
			),
		check(
			'repository_external_sources_cutover_state_check',
			sql`((${table.mirrorMode}::text = 'tessera_source' and ${table.cutoverAt} is not null and ${table.cutoverFromMirrorMode}::text = 'github_to_tessera') or (${table.mirrorMode}::text <> 'tessera_source' and ${table.cutoverActorUserId} is null and ${table.cutoverAt} is null and ${table.cutoverFromMirrorMode} is null))`
		),
		check(
			'repository_external_sources_github_push_back_enabled_check',
			sql`(${table.githubPushBackEnabled} = false or (${table.provider}::text = 'github' and ${table.mirrorMode}::text = 'tessera_source'))`
		),
		check(
			'repository_external_sources_sync_versions_check',
			sql`${table.requestedSyncVersion} >= 0 and ${table.completedSyncVersion} >= 0 and ${table.completedSyncVersion} <= ${table.requestedSyncVersion}`
		),
		check(
			'repository_external_sources_authority_generation_check',
			sql`${table.authorityGeneration} > 0`
		),
		check(
			'repository_external_sources_sync_lease_check',
			sql`(
				(${table.syncLeaseOwner} is null and ${table.syncLeaseAcquiredAt} is null and ${table.syncLeaseExpiresAt} is null)
				or (${table.syncLeaseOwner} is not null and ${table.syncLeaseAcquiredAt} is not null and ${table.syncLeaseExpiresAt} is not null and ${table.syncLeaseExpiresAt} > ${table.syncLeaseAcquiredAt})
			)`
		),
	]
)

export type RepositoryExternalSource =
	typeof repositoryExternalSources.$inferSelect
export type NewRepositoryExternalSource =
	typeof repositoryExternalSources.$inferInsert
export type GitHubInstallation = typeof gitHubInstallations.$inferSelect
export type NewGitHubInstallation = typeof gitHubInstallations.$inferInsert

export const repositoryExternalSourceRelations = relations(
	repositoryExternalSources,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryExternalSources.repositoryId],
			references: [repositories.id],
		}),
		cutoverActorUser: one(user, {
			fields: [repositoryExternalSources.cutoverActorUserId],
			references: [user.id],
		}),
		installation: one(gitHubInstallations, {
			fields: [repositoryExternalSources.installationId],
			references: [gitHubInstallations.id],
		}),
	})
)

export const gitHubInstallationRelations = relations(
	gitHubInstallations,
	({ many }) => ({
		repositoryExternalSources: many(repositoryExternalSources),
	})
)
