import {
	type BranchProtectionBypassRole,
	type BranchProtectionRuleId,
	branchProtectionBypassRoles,
	type CheckKind,
	type RepositoryId,
	type UserId,
} from '@repo/domain'
import { relations, sql } from 'drizzle-orm'
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.schema'
import { repositories } from './repositories.schema'

export const branchProtectionBypassRoleEnum = pgEnum(
	'branch_protection_bypass_role',
	branchProtectionBypassRoles
)

/**
 * A check the rule requires on the head commit. `kind` and `providerAppId` are
 * the selectors that tell two identically named checks apart; a requirement
 * omitting them matches on the name alone.
 */
export interface BranchProtectionRequiredContext {
	context: string
	kind?: CheckKind
	providerAppId?: string
}

/**
 * The policy a rule carried at one moment, copied into the repository audit log
 * so a merge decision stays readable after the rule itself changes or is
 * deleted.
 */
export interface BranchProtectionRuleSnapshot {
	targetBranch: string
	requiredApprovals: number
	requiredCheckContexts: BranchProtectionRequiredContext[]
	requireThreadsResolved: boolean
	dismissStaleApprovals: boolean
	bypassMinimumRole?: BranchProtectionBypassRole
	version: number
}

/**
 * One rule per exact target branch. `version` is what optimistic settings
 * updates compare against and what merge audit rows record, so a bypass can
 * always be read back against the exact policy it bypassed.
 */
export const branchProtectionRules = pgTable(
	'branch_protection_rules',
	{
		id: uuid('id').primaryKey().defaultRandom().$type<BranchProtectionRuleId>(),
		repositoryId: uuid('repository_id')
			.notNull()
			.$type<RepositoryId>()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		targetBranch: text('target_branch').notNull(),
		requiredApprovals: integer('required_approvals').default(0).notNull(),
		requiredCheckContexts: jsonb('required_check_contexts')
			.$type<BranchProtectionRequiredContext[]>()
			.default([])
			.notNull(),
		requireThreadsResolved: boolean('require_threads_resolved')
			.default(false)
			.notNull(),
		dismissStaleApprovals: boolean('dismiss_stale_approvals')
			.default(true)
			.notNull(),
		/** Absent is bypass disabled; a role is the minimum that may use it. */
		bypassMinimumRole: branchProtectionBypassRoleEnum('bypass_minimum_role'),
		version: integer('version').default(1).notNull(),
		// restrict is deliberate: a rule names who configured the gate, so account
		// deletion has to handle branch protection explicitly (mirrors the audit
		// tables this rule is written alongside).
		createdByUserId: uuid('created_by_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		updatedByUserId: uuid('updated_by_user_id')
			.notNull()
			.$type<UserId>()
			.references(() => user.id, { onDelete: 'restrict' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at')
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	table => [
		unique('branch_protection_rules_repository_target_branch_unique').on(
			table.repositoryId,
			table.targetBranch
		),
		index('branch_protection_rules_created_by_user_id_idx').on(
			table.createdByUserId
		),
		index('branch_protection_rules_updated_by_user_id_idx').on(
			table.updatedByUserId
		),
		check(
			'branch_protection_rules_target_branch_check',
			sql`length(btrim(${table.targetBranch})) > 0`
		),
		check(
			'branch_protection_rules_required_approvals_check',
			sql`${table.requiredApprovals} >= 0`
		),
		check('branch_protection_rules_version_check', sql`${table.version} > 0`),
	]
)

export type BranchProtectionRule = typeof branchProtectionRules.$inferSelect
export type NewBranchProtectionRule = typeof branchProtectionRules.$inferInsert

export const branchProtectionRuleRelations = relations(
	branchProtectionRules,
	({ one }) => ({
		repository: one(repositories, {
			fields: [branchProtectionRules.repositoryId],
			references: [repositories.id],
		}),
		createdByUser: one(user, {
			fields: [branchProtectionRules.createdByUserId],
			references: [user.id],
			relationName: 'branch_protection_rule_creator',
		}),
		updatedByUser: one(user, {
			fields: [branchProtectionRules.updatedByUserId],
			references: [user.id],
			relationName: 'branch_protection_rule_updater',
		}),
	})
)
