import type { MergeStrategyAvailability } from '@repo/contracts'
import type {
	MergeStrategy,
	MergeStrategyUnavailableReason,
} from '@repo/domain'
import { mergeStrategies } from '@repo/domain'

/** The methods, in the order they are offered. */
export const MERGE_STRATEGY_ORDER: readonly MergeStrategy[] = mergeStrategies

/** GitHub merges pull requests three ways; fast-forward is not one of them. */
export const GITHUB_MERGE_STRATEGY_ORDER: readonly MergeStrategy[] =
	MERGE_STRATEGY_ORDER.filter(strategy => strategy !== 'fast_forward')

/** What the button says once a method is chosen. */
export function getMergeStrategyLabel(strategy: MergeStrategy): string {
	switch (strategy) {
		case 'merge_commit':
			return 'Merge commit'
		case 'squash':
			return 'Squash and merge'
		case 'rebase':
			return 'Rebase and merge'
		default:
			return 'Fast-forward'
	}
}

/** What that method will do to the target branch, in one sentence. */
export function getMergeStrategyDescription(
	strategy: MergeStrategy,
	targetBranch: string
): string {
	switch (strategy) {
		case 'merge_commit':
			return `Create a two-parent merge commit on ${targetBranch}.`
		case 'squash':
			return `Combine every commit into one and add it to ${targetBranch}.`
		case 'rebase':
			return `Replay each commit onto ${targetBranch}, keeping their authors.`
		default:
			return `Move ${targetBranch} forward to the source branch, adding no commit.`
	}
}

/** Why that method cannot be used on these branches, in the reader's terms. */
export function getMergeStrategyUnavailableMessage(
	reason: MergeStrategyUnavailableReason
): string {
	switch (reason) {
		case 'conflict':
			return 'The branches conflict.'
		case 'not_fast_forward':
			return 'The branches have diverged.'
		case 'already_up_to_date':
			return 'The branches already match.'
		case 'nothing_to_rebase':
			return 'There is nothing left to replay.'
		default:
			return 'This history cannot be replayed.'
	}
}

export function findMergeStrategyAvailability(
	strategyAvailability: MergeStrategyAvailability[] | undefined,
	strategy: MergeStrategy
): MergeStrategyAvailability | undefined {
	return strategyAvailability?.find(entry => entry.strategy === strategy)
}

/**
 * The method to offer, given what the reader picked and what the server last
 * said is possible.
 *
 * A selection the branches have since made impossible falls back to the first
 * method that is still available, so the panel never presents a button that is
 * certain to be refused. With no availability yet — the requirements have not
 * answered, or the pull request is not one Tessera can merge — the selection
 * stands: there is nothing to contradict it.
 */
export function resolveMergeStrategy(
	selected: MergeStrategy,
	strategyAvailability: MergeStrategyAvailability[] | undefined,
	strategies: readonly MergeStrategy[] = MERGE_STRATEGY_ORDER
): MergeStrategy {
	// A selection the active list no longer offers falls back like an unavailable one.
	const candidate = strategies.includes(selected)
		? selected
		: (strategies[0] ?? selected)

	if (!strategyAvailability?.length) return candidate

	const availability = findMergeStrategyAvailability(
		strategyAvailability,
		candidate
	)

	if (!availability || availability.available) return candidate

	return (
		strategies.find(
			strategy =>
				findMergeStrategyAvailability(strategyAvailability, strategy)?.available
		) ?? candidate
	)
}
