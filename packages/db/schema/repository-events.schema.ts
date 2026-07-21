import type {
	RepositoryCollaboratorRole,
	RepositoryEventId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { relations } from 'drizzle-orm'
import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export const repositoryEventTypeEnum = pgEnum('repository_event_type', [
	'collaborator_added',
	'collaborator_role_changed',
	'collaborator_removed',
])

export type RepositoryEventPayload =
	| {
			type: 'collaborator_added'
			collaboratorUserId: UserId
			role: RepositoryCollaboratorRole
	  }
	| {
			type: 'collaborator_role_changed'
			collaboratorUserId: UserId
			previousRole: RepositoryCollaboratorRole
			role: RepositoryCollaboratorRole
	  }
	| {
			type: 'collaborator_removed'
			collaboratorUserId: UserId
			role: RepositoryCollaboratorRole
	  }

export const repositoryEvents = pgTable(
	'repository_events',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<RepositoryEventId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		// restrict is deliberate: audit rows must keep a real actor, so account
		// deletion has to handle/anonymize repository events explicitly
		// (mirrors pull_request_events).
		actorUserId: uuid('actor_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		type: repositoryEventTypeEnum('type').notNull(),
		payload: jsonb('payload').$type<RepositoryEventPayload>().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	table => [
		index('repository_events_repository_created_at_idx').on(
			table.repositoryId,
			table.createdAt
		),
	]
)

export type RepositoryEvent = typeof repositoryEvents.$inferSelect
export type NewRepositoryEvent = typeof repositoryEvents.$inferInsert

export const repositoryEventRelations = relations(
	repositoryEvents,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryEvents.repositoryId],
			references: [repositories.id],
		}),
		actorUser: one(user, {
			fields: [repositoryEvents.actorUserId],
			references: [user.id],
			relationName: 'repository_event_actor',
		}),
	})
)
