import type { CheckRollupState, CheckState } from '@repo/contracts'

/**
 * GitHub counts `neutral` and `skipped` as passing results for a required check,
 * and Tessera follows it: a check that deliberately did not run is not a check
 * that failed.
 */
const SATISFYING_CHECK_STATES = new Set<CheckState>([
	'success',
	'neutral',
	'skipped',
])

const PENDING_CHECK_STATES = new Set<CheckState>(['queued', 'pending'])

const CHECK_STATES = [
	'queued',
	'pending',
	'success',
	'failure',
	'neutral',
	'canceled',
	'skipped',
	'timed_out',
	'stale',
] as const satisfies readonly CheckState[]

export function isSatisfyingCheckState(state: CheckState): boolean {
	return SATISFYING_CHECK_STATES.has(state)
}

export function isPendingCheckState(state: CheckState): boolean {
	return PENDING_CHECK_STATES.has(state)
}

/**
 * Everything a provider finished without satisfying: a failure, a cancellation,
 * a timeout, and GitHub's own `stale` conclusion for a result it invalidated.
 */
export function isFailingCheckState(state: CheckState): boolean {
	return !(isSatisfyingCheckState(state) || isPendingCheckState(state))
}

/**
 * Failure dominates pending and pending dominates success. A commit nothing
 * reported on rolls up to `none`, which deliberately does not read as passing.
 */
export function toCheckRollupState(
	states: Iterable<CheckState>
): CheckRollupState {
	let rollup: CheckRollupState = 'none'

	for (const state of states) {
		if (isFailingCheckState(state)) return 'failure'

		if (isPendingCheckState(state)) rollup = 'pending'
		else if (rollup === 'none') rollup = 'success'
	}

	return rollup
}

/** Every state carries a count, so a client can read zeros without knowing the vocabulary. */
export function toCheckStateCounts(
	states: Iterable<CheckState>
): Record<CheckState, number> {
	const counts = Object.fromEntries(
		CHECK_STATES.map(state => [state, 0])
	) as Record<CheckState, number>

	for (const state of states) counts[state] += 1

	return counts
}
