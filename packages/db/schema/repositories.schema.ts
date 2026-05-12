import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	RepositoryVisibility,
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
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { organization } from './organizations.schema'

export const repositoryVisibilityEnum = pgEnum('repository_visibility', [
	'public',
	'private',
])

export const repositories = pgTable(
	'repositories',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<RepositoryId>(),
		slug: text('slug').notNull().$type<RepositorySlug>(),
		name: text('name').notNull().$type<RepositoryName>(),
		description: text('description'),
		visibility: repositoryVisibilityEnum('visibility')
			.default('private')
			.notNull()
			.$type<RepositoryVisibility>(),
		ownerUserId: uuid('owner_user_id')
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		ownerOrganizationId: uuid('owner_organization_id')
			.$type<OrganizationId>()
			.references(() => organization.id, { onDelete: 'cascade' }),
		defaultBranch: text('default_branch').default('main').notNull(),
		storagePath: text('storage_path'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('repositories_owner_user_id_idx').on(table.ownerUserId),
		index('repositories_owner_organization_id_idx').on(
			table.ownerOrganizationId
		),
		unique('repositories_owner_user_slug_unique').on(
			table.ownerUserId,
			table.slug
		),
		unique('repositories_owner_organization_slug_unique').on(
			table.ownerOrganizationId,
			table.slug
		),
		check(
			'repositories_exactly_one_owner_check',
			sql`((case when ${table.ownerUserId} is not null then 1 else 0 end) + (case when ${table.ownerOrganizationId} is not null then 1 else 0 end)) = 1`
		),
	]
)

export type Repository = typeof repositories.$inferSelect
export type NewRepository = typeof repositories.$inferInsert

export const repositoryRelations = relations(repositories, ({ one }) => ({
	ownerUser: one(user, {
		fields: [repositories.ownerUserId],
		references: [user.id],
	}),
	ownerOrganization: one(organization, {
		fields: [repositories.ownerOrganizationId],
		references: [organization.id],
	}),
}))
