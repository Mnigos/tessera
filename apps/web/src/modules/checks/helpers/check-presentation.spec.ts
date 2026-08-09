import type { CheckState, ChecksSummary } from '@repo/contracts'
import {
	formatCheckDuration,
	getCheckRollupCount,
	getCheckRollupDescription,
	getCheckStatePresentation,
} from './check-presentation'

const COUNTS = {
	queued: 1,
	pending: 2,
	success: 3,
	failure: 4,
	neutral: 5,
	canceled: 6,
	skipped: 7,
	timed_out: 8,
	stale: 9,
} satisfies Record<CheckState, number>
const EMPTY_COUNTS = {
	queued: 0,
	pending: 0,
	success: 0,
	failure: 0,
	neutral: 0,
	canceled: 0,
	skipped: 0,
	timed_out: 0,
	stale: 0,
} satisfies Record<CheckState, number>

describe('pull request check presentation', () => {
	test.each(
		Object.keys(COUNTS) as CheckState[]
	)('gives %s a visible label', state => {
		expect(getCheckStatePresentation(state).label).toBeTruthy()
	})

	test.each([
		['none', 0, 'No checks have reported'],
		['pending', 3, '3 checks pending'],
		['success', 15, '15 checks completed'],
		['failure', 27, '27 checks require attention'],
	] as const)('describes %s rollups', (overall, count, description) => {
		const summary = checksSummary(overall)

		expect(getCheckRollupCount(summary)).toBe(count)
		expect(getCheckRollupDescription(summary)).toBe(description)
	})

	test('never calls a canceled or skipped result failed or passed', () => {
		// The failure rollup counts canceled, timed-out and stale results too, and
		// the success rollup counts neutral and skipped ones. This description is
		// all a screen reader gets, so it must not claim an outcome nobody reported.
		const canceled = checksSummary('failure', {
			...EMPTY_COUNTS,
			canceled: 1,
		})
		const skipped = checksSummary('success', { ...EMPTY_COUNTS, skipped: 2 })

		expect(getCheckRollupDescription(canceled)).toBe(
			'1 check requires attention'
		)
		expect(getCheckRollupDescription(skipped)).toBe('2 checks completed')
	})

	test('formats coarse durations', () => {
		expect(formatCheckDuration(undefined)).toBeUndefined()
		expect(formatCheckDuration(30_400)).toBe('30s')
		expect(formatCheckDuration(90_000)).toBe('1m 30s')
		expect(formatCheckDuration(3_900_000)).toBe('1h 5m')
	})
})

function checksSummary(
	overall: ChecksSummary['overall'],
	counts: Record<CheckState, number> = COUNTS
): ChecksSummary {
	return {
		headSha: 'head',
		overall,
		counts,
		headIsCurrent: true,
	}
}
