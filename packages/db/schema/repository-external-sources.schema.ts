import type { Brand, RepositoryId, UserId } from '@repo/domain'
import { and, eq, isNotNull, relations, type SQL, sql } from 'drizzle-orm'
import {
	bigint,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export type RepositoryExternalSourceId = Brand<
	string,
	'repository_external_source_id'
>

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
	['pending', 'running', 'succeeded', 'failed']
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
		syncFailureReason: text('sync_failure_reason'),
		cutoverActorUserId: uuid('cutover_actor_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'set null' }),
		cutoverAt: timestamp('cutover_at'),
		cutoverFromMirrorMode: repositoryExternalSourceMirrorModeEnum(
			'cutover_from_mirror_mode'
		),
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
	]
)

export type RepositoryExternalSource =
	typeof repositoryExternalSources.$inferSelect
export type NewRepositoryExternalSource =
	typeof repositoryExternalSources.$inferInsert

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
	})
)
