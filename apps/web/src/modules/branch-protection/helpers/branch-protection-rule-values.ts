import type {
	BranchProtectionBypassPolicy,
	BranchProtectionRule,
	CheckKind,
	RequiredContext,
} from '@repo/contracts'

/**
 * A required check while it is being edited. The `id` exists only so React can
 * key rows that are still empty or identical to one another.
 */
export interface RequiredContextRow {
	id: string
	context: string
	kind?: CheckKind
	providerAppId?: string
}

export interface BranchProtectionRuleFormValues {
	targetBranch: string
	requiredApprovals: number
	requiredCheckContexts: RequiredContextRow[]
	requireThreadsResolved: boolean
	dismissStaleApprovals: boolean
	bypass: BranchProtectionBypassPolicy
}

let lastRequiredContextRowId = 0

export function createRequiredContextRow(
	requirement?: RequiredContext
): RequiredContextRow {
	lastRequiredContextRowId += 1

	return {
		id: `required-check-${lastRequiredContextRowId}`,
		context: requirement?.context ?? '',
		kind: requirement?.kind,
		providerAppId: requirement?.providerAppId,
	}
}

export function createBranchProtectionRuleFormValues(): BranchProtectionRuleFormValues {
	return {
		targetBranch: '',
		requiredApprovals: 1,
		requiredCheckContexts: [],
		requireThreadsResolved: false,
		dismissStaleApprovals: true,
		bypass: { allowed: false },
	}
}

export function toBranchProtectionRuleFormValues(
	rule: BranchProtectionRule
): BranchProtectionRuleFormValues {
	return {
		targetBranch: rule.targetBranch,
		requiredApprovals: rule.requiredApprovals,
		requiredCheckContexts: rule.requiredCheckContexts.map(requirement =>
			createRequiredContextRow(requirement)
		),
		requireThreadsResolved: rule.requireThreadsResolved,
		dismissStaleApprovals: rule.dismissStaleApprovals,
		bypass: rule.bypass,
	}
}

/**
 * Rows the editor is still holding open contribute nothing until they name a
 * check, and a blank provider is no provider rather than an empty one.
 */
export function toRequiredContexts(
	rows: RequiredContextRow[]
): RequiredContext[] {
	return rows.flatMap(({ context, kind, providerAppId }) => {
		const trimmedContext = context.trim()

		if (!trimmedContext) return []

		return [
			{
				context: trimmedContext,
				kind,
				providerAppId: providerAppId?.trim() || undefined,
			},
		]
	})
}
