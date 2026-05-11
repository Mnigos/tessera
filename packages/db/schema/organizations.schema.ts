import type { OrganizationId, UserId } from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export const organizationMemberRoleEnum = pgEnum('organization_member_role', [
	'owner',
	'admin',
	'member',
])

export const invitationStatusEnum = pgEnum('invitation_status', [
	'pending',
	'accepted',
	'rejected',
	'canceled',
])

export const organization = pgTable('organization', {
	id: uuid('id').primaryKey().defaultRandom().$type<OrganizationId>(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	logo: text('logo'),
	metadata: text('metadata'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
})

export type Organization = typeof organization.$inferSelect
export type NewOrganization = typeof organization.$inferInsert

export const member = pgTable(
	'member',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.$type<OrganizationId>()
			.references(() => organization.id, { onDelete: 'cascade' }),
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
		unique('member_organization_user_unique').on(
			table.organizationId,
			table.userId
		),
		index('member_user_id_idx').on(table.userId),
		index('member_organization_id_idx').on(table.organizationId),
	]
)

export type Member = typeof member.$inferSelect
export type NewMember = typeof member.$inferInsert

export const invitation = pgTable(
	'invitation',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		inviterId: uuid('inviter_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		organizationId: uuid('organization_id')
			.notNull()
			.$type<OrganizationId>()
			.references(() => organization.id, { onDelete: 'cascade' }),
		role: organizationMemberRoleEnum('role'),
		status: invitationStatusEnum('status').default('pending').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
	},
	table => [
		index('invitation_email_idx').on(table.email),
		index('invitation_organization_id_idx').on(table.organizationId),
		index('invitation_inviter_id_idx').on(table.inviterId),
	]
)

export type Invitation = typeof invitation.$inferSelect
export type NewInvitation = typeof invitation.$inferInsert

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(member),
	repositories: many(repositories),
	invitations: many(invitation),
}))

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	inviter: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
}))
