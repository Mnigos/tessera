import type {
	BranchProtectionRule as BranchProtectionRuleOutput,
	RequiredContext,
} from '@repo/contracts'
import type { BranchProtectionRuleSnapshot } from '@repo/db'
import type {
	BranchProtectionBypassRole,
	BranchProtectionRuleId,
} from '@repo/domain'

export interface BranchProtectionRuleView {
	id: BranchProtectionRuleId
	targetBranch: string
	requiredApprovals: number
	requiredCheckContexts: RequiredContext[]
	requireThreadsResolved: boolean
	dismissStaleApprovals: boolean
	bypassMinimumRole: BranchProtectionBypassRole | null
	version: number
	createdAt: Date
	updatedAt: Date
}

export function toBranchProtectionRuleOutput(
	rule: BranchProtectionRuleView
): BranchProtectionRuleOutput {
	return {
		id: rule.id,
		targetBranch: rule.targetBranch,
		requiredApprovals: rule.requiredApprovals,
		requiredCheckContexts: rule.requiredCheckContexts,
		requireThreadsResolved: rule.requireThreadsResolved,
		dismissStaleApprovals: rule.dismissStaleApprovals,
		bypass: rule.bypassMinimumRole
			? { allowed: true, minimumRole: rule.bypassMinimumRole }
			: { allowed: false },
		version: rule.version,
		createdAt: rule.createdAt,
		updatedAt: rule.updatedAt,
	}
}

/**
 * The policy as the audit log has to keep it: flat, self-contained, and still
 * readable once the rule it came from has been edited or deleted.
 */
export function toBranchProtectionRuleSnapshot(
	rule: BranchProtectionRuleView
): BranchProtectionRuleSnapshot {
	return {
		targetBranch: rule.targetBranch,
		requiredApprovals: rule.requiredApprovals,
		requiredCheckContexts: rule.requiredCheckContexts,
		requireThreadsResolved: rule.requireThreadsResolved,
		dismissStaleApprovals: rule.dismissStaleApprovals,
		bypassMinimumRole: rule.bypassMinimumRole ?? undefined,
		version: rule.version,
	}
}

/**
 * Stored requirements are deduplicated and ordered so two rules asking for the
 * same checks compare equal, and so an audit diff of two snapshots shows a
 * policy change rather than a reordering.
 */
export function canonicalizeRequiredContexts(
	contexts: RequiredContext[]
): RequiredContext[] {
	const byKey = new Map<string, RequiredContext>()

	for (const requirement of contexts)
		byKey.set(toRequiredContextKey(requirement), requirement)

	return [...byKey.entries()]
		.sort(([left], [right]) => compareRequiredContextKeys(left, right))
		.map(([, requirement]) => requirement)
}

function toRequiredContextKey({
	context,
	kind,
	providerAppId,
}: RequiredContext) {
	// JSON of the three parts is injective, so two differently split
	// requirements can never collide on one key.
	return JSON.stringify([context, kind ?? null, providerAppId ?? null])
}

function compareRequiredContextKeys(left: string, right: string) {
	if (left === right) return 0

	return left < right ? -1 : 1
}
