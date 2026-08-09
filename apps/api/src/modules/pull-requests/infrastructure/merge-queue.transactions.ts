import {
	and,
	type DrizzleTransaction,
	eq,
	inArray,
	type MergeQueueBlockingReasonSnapshot,
	mergeQueueEntries,
	pullRequestEvents,
	repositoryMergeQueueStates,
	sql,
} from '@repo/db'
import type {
	MergeQueueEntryId,
	MergeQueueState,
	MergeStrategy,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'

/**
 * States an entry still belongs to the queue in. `paused` is one of them: the
 * entry is retained and visible, it simply cannot run.
 */
export const ACTIVE_MERGE_QUEUE_STATES = [
	'queued',
	'validating',
	'merging',
	'paused',
] as const satisfies readonly MergeQueueState[]

/** States an entry is waiting in or already moving through. */
export const RUNNABLE_MERGE_QUEUE_STATES = [
	'queued',
	'validating',
	'merging',
] as const satisfies readonly MergeQueueState[]

/**
 * States a person may take their pull request back out of the queue from.
 *
 * `merging` is not one of them. Git has been asked to move the branch by the
 * time an entry is in it, and withdrawing the entry from under that leaves a
 * pull request that merged and a queue that says it was removed — a
 * contradiction no later read can resolve. Waiting is short: the merge either
 * lands or hands the entry back.
 */
export const USER_REMOVABLE_MERGE_QUEUE_STATES = [
	'queued',
	'validating',
	'paused',
] as const satisfies readonly MergeQueueState[]

export const MERGE_QUEUE_ENTRY_COLUMNS = {
	id: mergeQueueEntries.id,
	pullRequestId: mergeQueueEntries.pullRequestId,
	position: mergeQueueEntries.position,
	state: mergeQueueEntries.state,
	strategy: mergeQueueEntries.strategy,
	squashTitle: mergeQueueEntries.squashTitle,
	squashBody: mergeQueueEntries.squashBody,
	blockingReasons: mergeQueueEntries.blockingReasons,
	enqueuedByUserId: mergeQueueEntries.enqueuedByUserId,
	enqueuedAt: mergeQueueEntries.enqueuedAt,
	stateChangedAt: mergeQueueEntries.stateChangedAt,
}

interface RemoveActiveEntryParams {
	actorUserId?: UserId
	pullRequestId: PullRequestId
	reason: 'user' | 'admin' | 'closed' | 'merged'
	/** Narrows what may be removed; defaults to every state an entry is held in. */
	removableStates?: readonly MergeQueueState[]
}

export interface MergeQueueEntryRow {
	id: MergeQueueEntryId
	pullRequestId: PullRequestId
	position: number
	state: MergeQueueState
	/** The method this entry will merge by, fixed when it was queued. */
	strategy: MergeStrategy
	squashTitle: string | null
	squashBody: string | null
	blockingReasons: MergeQueueBlockingReasonSnapshot[] | null
	enqueuedByUserId: UserId
	enqueuedAt: Date
	stateChangedAt: Date
}

/**
 * Takes the repository's queue-state row for the rest of the transaction.
 *
 * Positions are allocated under it and never renumbered, so two callers
 * enqueueing at once are ordered by who holds this row rather than by who
 * happened to read the highest position first.
 */
export async function lockMergeQueueState(
	tx: DrizzleTransaction,
	repositoryId: RepositoryId
): Promise<void> {
	await tx
		.insert(repositoryMergeQueueStates)
		.values({ repositoryId })
		.onConflictDoNothing()
	await tx
		.select({ repositoryId: repositoryMergeQueueStates.repositoryId })
		.from(repositoryMergeQueueStates)
		.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))
		.limit(1)
		.for('update')
}

/**
 * The next place at the back of the queue. Terminal entries keep their
 * positions, so this only ever grows and a re-enqueued pull request lands
 * behind everything that was already waiting.
 */
export async function allocateMergeQueuePosition(
	tx: DrizzleTransaction,
	repositoryId: RepositoryId
): Promise<number> {
	const [row] = await tx
		.select({
			highest: sql<number>`coalesce(max(${mergeQueueEntries.position}), 0)`,
		})
		.from(mergeQueueEntries)
		.where(eq(mergeQueueEntries.repositoryId, repositoryId))

	return (row?.highest ?? 0) + 1
}

/**
 * Announces that the repository's queue changed, and reports the version to
 * wake the worker with. The pair of versions is what tells a committed change
 * whose Redis wakeup was lost from one that has already been served.
 */
export async function requestMergeQueueWakeup(
	tx: DrizzleTransaction,
	repositoryId: RepositoryId
): Promise<number> {
	const [state] = await tx
		.update(repositoryMergeQueueStates)
		.set({
			requestedVersion: sql`${repositoryMergeQueueStates.requestedVersion} + 1`,
		})
		.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))
		.returning({
			requestedVersion: repositoryMergeQueueStates.requestedVersion,
		})

	if (!state) throw new Error('merge queue state row is missing')

	return state.requestedVersion
}

/**
 * Drops whatever active entry a pull request still holds, and says which one it
 * was. Called from the transaction that closed or merged the pull request, so
 * an entry can never outlive the thing it was waiting to merge.
 */
export async function removeActiveMergeQueueEntry(
	tx: DrizzleTransaction,
	{
		actorUserId,
		pullRequestId,
		reason,
		removableStates = ACTIVE_MERGE_QUEUE_STATES,
	}: RemoveActiveEntryParams
): Promise<MergeQueueEntryRow | undefined> {
	const removedAt = new Date()
	const [entry] = await tx
		.update(mergeQueueEntries)
		.set({
			state: 'removed',
			removedAt,
			removedByUserId: actorUserId,
			stateChangedAt: removedAt,
		})
		.where(
			and(
				eq(mergeQueueEntries.pullRequestId, pullRequestId),
				inArray(mergeQueueEntries.state, [...removableStates])
			)
		)
		.returning(MERGE_QUEUE_ENTRY_COLUMNS)

	if (!entry) return undefined

	await tx.insert(pullRequestEvents).values({
		pullRequestId,
		actorUserId,
		type: 'queue_removed',
		payload: { queueEntryId: entry.id, position: entry.position, reason },
	})

	return entry
}

/**
 * Marks the entry whose merge just landed as completed. Terminal on its own
 * merits: the `merged` event on the pull request is what records the outcome,
 * so no queue event is written beside it.
 *
 * Finding no such entry means something moved it while Git was merging, and the
 * transaction is failed rather than committed around the hole: the merge would
 * otherwise be recorded on the pull request while the entry that made it says it
 * never happened. Rolling back leaves the merge intent in place, and the retry
 * that follows finds the commit Git already made and completes on top of it.
 */
export async function completeMergeQueueEntry(
	tx: DrizzleTransaction,
	queueEntryId: MergeQueueEntryId
): Promise<void> {
	const completedAt = new Date()
	const completed = await tx
		.update(mergeQueueEntries)
		.set({ state: 'completed', completedAt, stateChangedAt: completedAt })
		.where(
			and(
				eq(mergeQueueEntries.id, queueEntryId),
				eq(mergeQueueEntries.state, 'merging')
			)
		)
		.returning({ id: mergeQueueEntries.id })

	if (completed.length !== 1)
		throw new Error(
			`merge queue entry ${queueEntryId} was no longer merging when its merge completed`
		)
}

/**
 * Restricts a write to the run that holds the repository's merge lease right
 * now.
 *
 * A worker whose lease aged out is indistinguishable from one that never had
 * it: the entry it is carrying may have been returned to the queue and picked up
 * by somebody else since, so the database refuses the write rather than let a
 * run that has already lost its turn move another run's entry.
 */
export function heldUnderMergeLease(owner: string) {
	return sql`exists (
		select 1
		from ${repositoryMergeQueueStates}
		where ${repositoryMergeQueueStates.repositoryId} = ${mergeQueueEntries.repositoryId}
			and ${repositoryMergeQueueStates.leaseOwner} = ${owner}
			and ${repositoryMergeQueueStates.leaseExpiresAt} > now()
	)`
}
