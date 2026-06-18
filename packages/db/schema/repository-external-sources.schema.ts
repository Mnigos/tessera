import type { Brand, RepositoryId } from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	bigint,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
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
	['imported', 'github_to_tessera']
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
				sql`${table.provider} = 'github' and ${table.mirrorMode} = 'github_to_tessera' and ${table.nextSyncAt} is not null`
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
	})
)
