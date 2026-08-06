import type {
	PullRequestEvent,
	PullRequestEventType,
	PullRequestThread,
} from '@repo/contracts'

export type PullRequestTimelineEntry =
	| { type: 'event'; id: string; createdAt: Date; event: PullRequestEvent }
	| { type: 'thread'; id: string; createdAt: Date; thread: PullRequestThread }

/**
 * Comment events stay in the audit trail but never render: the thread bubble is
 * the timeline entry for a comment.
 */
const SUPPRESSED_TIMELINE_EVENT_TYPES = new Set<PullRequestEventType>([
	'commented',
])

/**
 * Merges lifecycle events and top-level threads into a single chronological
 * timeline. Inline threads belong to the files view and are excluded.
 */
export function getPullRequestTimelineEntries(
	events: PullRequestEvent[],
	threads: PullRequestThread[]
): PullRequestTimelineEntry[] {
	const entries: PullRequestTimelineEntry[] = [
		...events
			.filter(event => !SUPPRESSED_TIMELINE_EVENT_TYPES.has(event.type))
			.map(event => ({
				type: 'event' as const,
				id: event.id,
				createdAt: event.createdAt,
				event,
			})),
		...threads
			.filter(thread => thread.kind === 'top_level')
			.map(thread => ({
				type: 'thread' as const,
				id: thread.id,
				createdAt: thread.createdAt,
				thread,
			})),
	]

	return entries.sort(
		(first, second) =>
			first.createdAt.getTime() - second.createdAt.getTime() ||
			first.id.localeCompare(second.id)
	)
}
