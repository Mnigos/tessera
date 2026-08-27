import type { Database } from '@config/database'
import { type DrizzleTransaction, inArray, pullRequests, sql } from '@repo/db'
import type { PullRequestId } from '@repo/domain'

export type PullRequestActivityDatabase = Database | DrizzleTransaction

interface TouchPullRequestActivityParams {
	pullRequestIds: PullRequestId[]
	/**
	 * When the activity happened, for the paths that date their own event rows —
	 * a push, a webhook, a synchronized review. Omitted means now, matching the
	 * default the event row itself is written with.
	 */
	occurredAt?: Date
}

/**
 * Moves the recent-activity mark on the pull requests an event was just
 * recorded against.
 *
 * Called in the same transaction as the event insert, so the mark and the
 * timeline it summarizes can never disagree. `greatest` rather than assignment
 * because backfilled and synchronized events arrive out of order, and an old
 * event surfacing late must not drag a pull request back down the list.
 *
 * `updatedAt` is written back to itself: the column carries an `$onUpdate`
 * hook, and letting it fire here would make every comment look like an edit to
 * the pull request, which is exactly the conflation this column exists to undo.
 */
export async function touchPullRequestActivity(
	db: PullRequestActivityDatabase,
	{ occurredAt, pullRequestIds }: TouchPullRequestActivityParams
): Promise<void> {
	if (pullRequestIds.length === 0) return

	// Cast from the same UTC wall-clock text Drizzle writes timestamps as, rather
	// than binding the date bare, so the mark lands on the value the event row
	// beside it was given.
	const activityAt = occurredAt
		? sql`${occurredAt.toISOString()}::timestamp`
		: sql`now()`

	await db
		.update(pullRequests)
		.set({
			lastActivityAt: sql`greatest(${pullRequests.lastActivityAt}, ${activityAt})`,
			updatedAt: sql`${pullRequests.updatedAt}`,
		})
		.where(inArray(pullRequests.id, pullRequestIds))
}
