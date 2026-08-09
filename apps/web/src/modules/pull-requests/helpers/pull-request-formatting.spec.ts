import type { PullRequestEvent } from '@repo/contracts'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
	getPullRequestHeadUpdate,
} from './pull-request-formatting'

const createdAt = new Date('2026-08-08T10:00:00.000Z')
const oldSha = '1'.repeat(40)
const newSha = '2'.repeat(40)

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

	test.each([
		['head_updated', 'Updated'],
		['force_pushed', 'Force-pushed'],
	] as const)('reads the branch a %s event moved', (type, verb) => {
		expect(
			getPullRequestHeadUpdate(
				event(type, { ref: 'refs/heads/feature', oldSha, newSha })
			)
		).toEqual({ verb, branch: 'feature', oldSha, newSha })
	})

	test('reads nothing from events that carry no branch movement', () => {
		expect(getPullRequestHeadUpdate(event('head_updated'))).toBeFalsy()
		expect(
			getPullRequestHeadUpdate(
				event('synchronized', {
					ref: 'refs/heads/feature',
					oldSha,
					newSha,
				})
			)
		).toBeFalsy()
	})
})

function event(
	type: PullRequestEvent['type'],
	payload?: PullRequestEvent['payload']
): PullRequestEvent {
	return {
		id: crypto.randomUUID() as PullRequestEvent['id'],
		pullRequestId: crypto.randomUUID() as PullRequestEvent['pullRequestId'],
		provider: 'tessera',
		actorUsername: 'marta',
		type,
		payload,
		createdAt,
	}
}
