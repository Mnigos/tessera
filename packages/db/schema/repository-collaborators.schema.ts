import {
	type RepositoryCollaboratorId,
	type RepositoryCollaboratorRole,
	type RepositoryId,
	repositoryCollaboratorRoles,
	type UserId,
} from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	index,
	pgEnum,
	pgTable,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export const repositoryCollaboratorRoleEnum = pgEnum(
	'repository_collaborator_role',
	repositoryCollaboratorRoles
)

export const repositoryCollaborators = pgTable(
	'repository_collaborators',
	{
		id: uuid('id')
			.primaryKey()
			.defaultRandom()
			.$type<RepositoryCollaboratorId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: repositoryCollaboratorRoleEnum('role')
			.notNull()
			.$type<RepositoryCollaboratorRole>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('repository_collaborators_repository_user_unique').on(
			table.repositoryId,
			table.userId
		),
		index('repository_collaborators_user_id_idx').on(table.userId),
	]
)

export type RepositoryCollaborator = typeof repositoryCollaborators.$inferSelect
export type NewRepositoryCollaborator =
	typeof repositoryCollaborators.$inferInsert

export const repositoryCollaboratorRelations = relations(
	repositoryCollaborators,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryCollaborators.repositoryId],
			references: [repositories.id],
		}),
		user: one(user, {
			fields: [repositoryCollaborators.userId],
			references: [user.id],
		}),
	})
)
