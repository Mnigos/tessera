import type { CheckState } from '@repo/contracts'
import {
	isFailingCheckState,
	isPendingCheckState,
	isSatisfyingCheckState,
	toCheckRollupState,
	toCheckStateCounts,
} from './check-state'

const STATES = [
	'queued',
	'pending',
	'success',
	'failure',
	'neutral',
	'canceled',
	'skipped',
	'timed_out',
	'stale',
] as const satisfies CheckState[]

describe('check state rules', () => {
	test.each(STATES)('classifies %s into exactly one outcome group', state => {
		expect(
			[
				isSatisfyingCheckState(state),
				isPendingCheckState(state),
				isFailingCheckState(state),
			].filter(Boolean)
		).toHaveLength(1)
	})

	test('applies failure then pending then success precedence', () => {
		expect(toCheckRollupState([])).toBe('none')
		expect(toCheckRollupState(['success', 'neutral', 'skipped'])).toBe(
			'success'
		)
		expect(toCheckRollupState(['success', 'queued'])).toBe('pending')
		expect(toCheckRollupState(['pending', 'failure'])).toBe('failure')
	})

	test('returns an explicit count for every native state', () => {
		expect(toCheckStateCounts(STATES)).toEqual(
			Object.fromEntries(STATES.map(state => [state, 1]))
		)
	})
})
