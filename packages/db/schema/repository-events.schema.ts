import type {
	BranchProtectionRuleId,
	CheckStatusCredentialId,
	CheckStatusProviderId,
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
import type { BranchProtectionRuleSnapshot } from './branch-protection.schema'
import { repositories } from './repositories.schema'

export const repositoryEventTypeEnum = pgEnum('repository_event_type', [
	'collaborator_added',
	'collaborator_role_changed',
	'collaborator_removed',
	'branch_protection_created',
	'branch_protection_updated',
	'branch_protection_deleted',
	// Issuing and revoking a publishing secret are repository-governance changes
	// and belong here. The statuses that secret then publishes do not: they are a
	// high-volume ledger of their own, and copying every one of them into the
	// audit log would bury the decisions this table exists to record.
	'check_status_credential_created',
	'check_status_credential_revoked',
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
	| {
			type: 'branch_protection_created'
			ruleId: BranchProtectionRuleId
			targetBranch: string
			current: BranchProtectionRuleSnapshot
	  }
	| {
			type: 'branch_protection_updated'
			ruleId: BranchProtectionRuleId
			targetBranch: string
			previous: BranchProtectionRuleSnapshot
			current: BranchProtectionRuleSnapshot
	  }
	| {
			type: 'branch_protection_deleted'
			ruleId: BranchProtectionRuleId
			targetBranch: string
			previous: BranchProtectionRuleSnapshot
	  }
	| {
			type: 'check_status_credential_created'
			providerId: CheckStatusProviderId
			providerKey: string
			credentialId: CheckStatusCredentialId
	  }
	| {
			type: 'check_status_credential_revoked'
			providerId: CheckStatusProviderId
			providerKey: string
			credentialId: CheckStatusCredentialId
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
