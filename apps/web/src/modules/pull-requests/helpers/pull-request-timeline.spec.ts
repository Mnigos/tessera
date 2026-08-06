import type {
	PullRequestEvent,
	PullRequestEventType,
	PullRequestThread,
	PullRequestThreadId,
} from '@repo/contracts'
import { getPullRequestTimelineEntries } from './pull-request-timeline'

const PULL_REQUEST_ID =
	'00000000-0000-4000-8000-000000000001' as PullRequestEvent['pullRequestId']

function event(
	id: string,
	type: PullRequestEventType,
	createdAt: string
): PullRequestEvent {
	return {
		id: id as PullRequestEvent['id'],
		pullRequestId: PULL_REQUEST_ID,
		provider: 'tessera',
		actorUsername: 'marta',
		type,
		createdAt: new Date(createdAt),
	}
}

function thread(
	id: string,
	kind: PullRequestThread['kind'],
	createdAt: string
): PullRequestThread {
	return {
		id: id as PullRequestThreadId,
		kind,
		outdated: false,
		createdAt: new Date(createdAt),
		comments: [],
	}
}

describe(getPullRequestTimelineEntries.name, () => {
	test('interleaves events and top-level threads chronologically', () => {
		const entries = getPullRequestTimelineEntries(
			[
				event(
					'00000000-0000-4000-8000-000000000003',
					'closed',
					'2026-08-06T12:00:00Z'
				),
				event(
					'00000000-0000-4000-8000-000000000001',
					'opened',
					'2026-08-06T10:00:00Z'
				),
			],
			[
				thread(
					'00000000-0000-4000-8000-000000000002',
					'top_level',
					'2026-08-06T11:00:00Z'
				),
			]
		)

		expect(entries.map(entry => entry.id)).toEqual([
			'00000000-0000-4000-8000-000000000001',
			'00000000-0000-4000-8000-000000000002',
			'00000000-0000-4000-8000-000000000003',
		])
	})

	test('suppresses commented events and excludes inline threads', () => {
		expect(
			getPullRequestTimelineEntries(
				[
					event(
						'00000000-0000-4000-8000-000000000004',
						'commented',
						'2026-08-06T10:00:00Z'
					),
					event(
						'00000000-0000-4000-8000-000000000005',
						'thread_resolved',
						'2026-08-06T11:00:00Z'
					),
				],
				[
					thread(
						'00000000-0000-4000-8000-000000000006',
						'inline',
						'2026-08-06T12:00:00Z'
					),
				]
			).map(entry => entry.id)
		).toEqual(['00000000-0000-4000-8000-000000000005'])
	})
})
