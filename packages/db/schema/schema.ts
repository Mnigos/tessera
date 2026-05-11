import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

export const repositoryVisibilityEnum = pgEnum('repository_visibility', [
	'public',
	'private',
])

export const organizationMemberRoleEnum = pgEnum('organization_member_role', [
	'owner',
	'admin',
	'member',
])

export const user = pgTable('user', {
	id: uuid('id').primaryKey().defaultRandom().$type<UserId>(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false).notNull(),
	image: text('image'),
	username: text('username').unique(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
})

export type User = typeof user.$inferSelect

export const session = pgTable(
	'session',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		expiresAt: timestamp('expires_at').notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: uuid('user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	table => [index('session_user_id_idx').on(table.userId)]
)

export type Session = typeof session.$inferSelect

export const account = pgTable(
	'account',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', {
			withTimezone: true,
			mode: 'date',
		}),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
			withTimezone: true,
			mode: 'date',
		}),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		index('account_user_id_idx').on(table.userId),
		unique('account_provider_account_unique').on(
			table.providerId,
			table.accountId
		),
	]
)

export type Account = typeof account.$inferSelect

export const verification = pgTable(
	'verification',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [index('verification_identifier_idx').on(table.identifier)]
)

export type Verification = typeof verification.$inferSelect

export const organizations = pgTable('organizations', {
	id: uuid('id').primaryKey().defaultRandom().$type<OrganizationId>(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
})

export type Organization = typeof organizations.$inferSelect

export const organizationMembers = pgTable(
	'organization_members',
	{
		organizationId: uuid('organization_id')
			.notNull()
			.$type<OrganizationId>()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: organizationMemberRoleEnum('role').default('member').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('organization_members_org_user_unique').on(
			table.organizationId,
			table.userId
		),
		index('organization_members_user_id_idx').on(table.userId),
	]
)

export type OrganizationMember = typeof organizationMembers.$inferSelect

export const repositories = pgTable(
	'repositories',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<RepositoryId>(),
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
			.references(() => organizations.id, { onDelete: 'cascade' }),
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
		unique('repositories_owner_user_name_unique').on(
			table.ownerUserId,
			table.name
		),
		unique('repositories_owner_organization_name_unique').on(
			table.ownerOrganizationId,
			table.name
		),
	]
)

export type Repository = typeof repositories.$inferSelect

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
	organizationMemberships: many(organizationMembers),
	repositories: many(repositories),
}))

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, { fields: [session.userId], references: [user.id] }),
}))

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const organizationRelations = relations(organizations, ({ many }) => ({
	members: many(organizationMembers),
	repositories: many(repositories),
}))

export const organizationMemberRelations = relations(
	organizationMembers,
	({ one }) => ({
		organization: one(organizations, {
			fields: [organizationMembers.organizationId],
			references: [organizations.id],
		}),
		user: one(user, {
			fields: [organizationMembers.userId],
			references: [user.id],
		}),
	})
)

export const repositoryRelations = relations(repositories, ({ one }) => ({
	ownerUser: one(user, {
		fields: [repositories.ownerUserId],
		references: [user.id],
	}),
	ownerOrganization: one(organizations, {
		fields: [repositories.ownerOrganizationId],
		references: [organizations.id],
	}),
}))
