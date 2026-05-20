import type { Brand, RepositoryId, RepositorySlug, UserId } from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	bigint,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export type RepositoryImportId = Brand<string, 'repository_import_id'>

export const repositoryImportStatusEnum = pgEnum('repository_import_status', [
	'pending',
	'running',
	'succeeded',
	'failed',
])

export const repositoryImportProviderEnum = pgEnum(
	'repository_import_provider',
	['github']
)

export const repositoryImportVisibilityEnum = pgEnum(
	'repository_import_visibility',
	['public', 'private', 'internal']
)

export const repositoryImports = pgTable(
	'repository_imports',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<RepositoryImportId>(),
		ownerUserId: uuid('owner_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		repositoryId: uuid('repository_id')
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'set null' }),
		provider: repositoryImportProviderEnum('provider')
			.notNull()
			.default('github'),
		targetName: text('target_name').notNull(),
		targetSlug: text('target_slug').notNull().$type<RepositorySlug>(),
		sourceGithubId: bigint('source_github_id', { mode: 'bigint' }).notNull(),
		sourceOwnerLogin: text('source_owner_login').notNull(),
		sourceName: text('source_name').notNull(),
		sourceFullName: text('source_full_name').notNull(),
		sourceVisibility: repositoryImportVisibilityEnum('source_visibility')
			.notNull()
			.default('private'),
		sourceDefaultBranch: text('source_default_branch').notNull(),
		sourceGithubUrl: text('source_github_url').notNull(),
		status: repositoryImportStatusEnum('status').notNull().default('pending'),
		failureReason: text('failure_reason'),
		startedAt: timestamp('started_at'),
		completedAt: timestamp('completed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('repository_imports_owner_user_id_idx').on(table.ownerUserId),
		index('repository_imports_repository_id_idx').on(table.repositoryId),
		index('repository_imports_status_idx').on(table.status),
		uniqueIndex('repository_imports_active_source_unique')
			.on(table.ownerUserId, table.sourceGithubId)
			.where(sql`${table.status} != 'failed'`),
		uniqueIndex('repository_imports_active_target_slug_unique')
			.on(table.ownerUserId, table.targetSlug)
			.where(sql`${table.status} != 'failed'`),
	]
)

export type RepositoryImport = typeof repositoryImports.$inferSelect
export type NewRepositoryImport = typeof repositoryImports.$inferInsert

export const repositoryImportRelations = relations(
	repositoryImports,
	({ one }) => ({
		ownerUser: one(user, {
			fields: [repositoryImports.ownerUserId],
			references: [user.id],
		}),
		repository: one(repositories, {
			fields: [repositoryImports.repositoryId],
			references: [repositories.id],
		}),
	})
)
