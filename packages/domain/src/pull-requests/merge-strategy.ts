/**
 * How a pull request's commits reach its target branch. Named the same way in
 * the database enum, the contract, the gRPC surface and the Git service, because
 * a merge is audited by strategy and the four have to be one vocabulary.
 */
export const mergeStrategies = [
	'merge_commit',
	'squash',
	'rebase',
	'fast_forward',
] as const

export type MergeStrategy = (typeof mergeStrategies)[number]

export const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'merge_commit'

/**
 * Why a strategy cannot run against the branches as they stand. These describe
 * the shape of the history rather than the caller or the policy: no role and no
 * waiver makes a fast-forward possible across diverged branches.
 */
export const mergeStrategyUnavailableReasons = [
	'conflict',
	'not_fast_forward',
	'already_up_to_date',
	'nothing_to_rebase',
	'unsupported_history',
] as const

export type MergeStrategyUnavailableReason =
	(typeof mergeStrategyUnavailableReasons)[number]
