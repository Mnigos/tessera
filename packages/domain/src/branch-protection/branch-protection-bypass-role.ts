/**
 * The repository roles a rule may hand a bypass to. Stored as the minimum role
 * that qualifies, so "bypass is off" is the absence of a role rather than a
 * second flag that could disagree with one.
 */
export const branchProtectionBypassRoles = ['admin', 'owner'] as const

export type BranchProtectionBypassRole =
	(typeof branchProtectionBypassRoles)[number]
