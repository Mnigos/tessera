import { oc } from '@orpc/contract'
import { branchProtectionBypassRoles } from '@repo/domain'
import { z } from 'zod'
import { requiredContextSchema } from './checks.contract'
import { repositorySlugSchema } from './repositories.contract'

export const branchProtectionRuleIdSchema = z
	.uuid()
	.brand<'branch_protection_rule_id'>()
export type BranchProtectionRuleId = z.infer<
	typeof branchProtectionRuleIdSchema
>

export const branchProtectionBypassRoleSchema = z.enum(
	branchProtectionBypassRoles
)
export type BranchProtectionBypassRole = z.infer<
	typeof branchProtectionBypassRoleSchema
>

/**
 * Bypass as one decision rather than a flag and a role that could disagree.
 * Persistence stores the minimum role alone and `allowed: false` is its absence.
 */
export const branchProtectionBypassPolicySchema = z.discriminatedUnion(
	'allowed',
	[
		z.object({ allowed: z.literal(false) }),
		z.object({
			allowed: z.literal(true),
			minimumRole: branchProtectionBypassRoleSchema,
		}),
	]
)
export type BranchProtectionBypassPolicy = z.infer<
	typeof branchProtectionBypassPolicySchema
>

export const branchProtectionRuleSchema = z.object({
	id: branchProtectionRuleIdSchema,
	targetBranch: z.string().min(1),
	requiredApprovals: z.number().int().nonnegative(),
	requiredCheckContexts: z.array(requiredContextSchema),
	requireThreadsResolved: z.boolean(),
	dismissStaleApprovals: z.boolean(),
	bypass: branchProtectionBypassPolicySchema,
	/** What an update must present to be accepted, and what a merge audit records. */
	version: z.number().int().positive(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type BranchProtectionRule = z.infer<typeof branchProtectionRuleSchema>

const branchProtectionRulesInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})

export const listBranchProtectionRulesInputSchema =
	branchProtectionRulesInputSchema
export type ListBranchProtectionRulesInput = z.input<
	typeof listBranchProtectionRulesInputSchema
>
export type ParsedListBranchProtectionRulesInput = z.infer<
	typeof listBranchProtectionRulesInputSchema
>

export const saveBranchProtectionRuleInputSchema =
	branchProtectionRulesInputSchema.extend({
		targetBranch: z.string().trim().min(1).max(255),
		requiredApprovals: z.number().int().min(0).max(100).default(0),
		requiredCheckContexts: z.array(requiredContextSchema).max(50).default([]),
		requireThreadsResolved: z.boolean().default(false),
		dismissStaleApprovals: z.boolean().default(true),
		bypass: branchProtectionBypassPolicySchema.default({ allowed: false }),
		/** Absent creates the rule; present must match the stored version. */
		expectedVersion: z.number().int().positive().optional(),
	})
export type SaveBranchProtectionRuleInput = z.input<
	typeof saveBranchProtectionRuleInputSchema
>
export type ParsedSaveBranchProtectionRuleInput = z.infer<
	typeof saveBranchProtectionRuleInputSchema
>

export const deleteBranchProtectionRuleInputSchema =
	branchProtectionRulesInputSchema.extend({
		ruleId: branchProtectionRuleIdSchema,
		expectedVersion: z.coerce.number().int().positive(),
	})
export type DeleteBranchProtectionRuleInput = z.input<
	typeof deleteBranchProtectionRuleInputSchema
>
export type ParsedDeleteBranchProtectionRuleInput = z.infer<
	typeof deleteBranchProtectionRuleInputSchema
>

export const branchProtectionContract = {
	list: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/branch-protection',
		})
		.input(listBranchProtectionRulesInputSchema)
		.output(
			z.object({
				rules: z.array(branchProtectionRuleSchema),
				/**
				 * False while GitHub owns the repository: rules may be configured ahead
				 * of cutover but gate nothing until Tessera owns the merge.
				 */
				enforced: z.boolean(),
			})
		),
	save: oc
		.route({
			method: 'PUT',
			path: '/repositories/{username}/{slug}/branch-protection',
		})
		.input(saveBranchProtectionRuleInputSchema)
		.output(branchProtectionRuleSchema),
	delete: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/branch-protection/{ruleId}',
		})
		.input(deleteBranchProtectionRuleInputSchema)
		.output(z.object({ deleted: z.boolean() })),
}
