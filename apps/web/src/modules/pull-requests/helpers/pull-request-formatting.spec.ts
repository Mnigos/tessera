import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from './pull-request-formatting'

describe('pull request formatting', () => {
	test('formats dates deterministically in UTC', () => {
		expect(formatPullRequestDate(new Date('2026-07-14T14:05:00.000Z'))).toBe(
			'Jul 14, 2026 at 2:05 PM UTC'
		)
		expect(formatPullRequestDate(new Date('2026-01-02T00:07:00.000Z'))).toBe(
			'Jan 2, 2026 at 12:07 AM UTC'
		)
	})

	test('formats time element values as ISO timestamps', () => {
		expect(
			formatPullRequestDateTime(new Date('2026-07-14T14:05:00.000Z'))
		).toBe('2026-07-14T14:05:00.000Z')
	})
})
