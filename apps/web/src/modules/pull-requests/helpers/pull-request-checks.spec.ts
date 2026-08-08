import type { CheckState, ChecksSummary } from '@repo/contracts'
import {
	formatCheckDuration,
	getCheckRollupCount,
	getCheckRollupDescription,
	getCheckStatePresentation,
} from './pull-request-checks'

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

describe('pull request check presentation', () => {
	test.each(
		Object.keys(COUNTS) as CheckState[]
	)('gives %s a visible label', state => {
		expect(getCheckStatePresentation(state).label).toBeTruthy()
	})

	test.each([
		['none', 0, 'No checks have reported'],
		['pending', 3, '3 checks running'],
		['success', 15, '15 checks passed'],
		['failure', 27, '27 checks failed'],
	] as const)('describes %s rollups', (overall, count, description) => {
		const summary = checksSummary(overall)

		expect(getCheckRollupCount(summary)).toBe(count)
		expect(getCheckRollupDescription(summary)).toBe(description)
	})

	test('formats coarse durations', () => {
		expect(formatCheckDuration(undefined)).toBeUndefined()
		expect(formatCheckDuration(30_400)).toBe('30s')
		expect(formatCheckDuration(90_000)).toBe('1m 30s')
		expect(formatCheckDuration(3_900_000)).toBe('1h 5m')
	})
})

function checksSummary(overall: ChecksSummary['overall']): ChecksSummary {
	return {
		headSha: 'head',
		overall,
		counts: COUNTS,
		enforcement: 'advisory',
		headIsCurrent: true,
	}
}
