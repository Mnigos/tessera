import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { MergeStrategySelection } from '@repo/contracts'
import {
	and,
	asc,
	count,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	type MergeQueueBlockingReasonSnapshot,
	mergeQueueEntries,
	ne,
	or,
	pullRequestEvents,
	pullRequests,
	repositoryMergeQueueStates,
	sql,
	user,
} from '@repo/db'
import type {
	MergeQueueEntryId,
	MergeQueueState,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import {
	ACTIVE_MERGE_QUEUE_STATES,
	allocateMergeQueuePosition,
	completeMergeQueueEntry,
	heldUnderMergeLease,
	lockMergeQueueState,
	MERGE_QUEUE_ENTRY_COLUMNS,
	type MergeQueueEntryRow,
	RUNNABLE_MERGE_QUEUE_STATES,
	removeActiveMergeQueueEntry,
	requestMergeQueueWakeup,
	USER_REMOVABLE_MERGE_QUEUE_STATES,
} from './merge-queue.transactions'

/** Why an entry is leaving the queue, which is also who asked for it. */
export type MergeQueueRemovalReason = 'user' | 'admin' | 'closed' | 'merged'

const REMOVABLE_STATES_BY_REASON: Record<
	MergeQueueRemovalReason,
	readonly MergeQueueState[]
> = {
	user: USER_REMOVABLE_MERGE_QUEUE_STATES,
	admin: USER_REMOVABLE_MERGE_QUEUE_STATES,
	closed: ACTIVE_MERGE_QUEUE_STATES,
	merged: ACTIVE_MERGE_QUEUE_STATES,
}

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface AcquireRepositoryMergeLeaseParams extends RepositoryParams {
	owner: string
	ttlMs: number
}

interface ReleaseRepositoryMergeLeaseParams extends RepositoryParams {
	owner: string
}

interface CountRunnableEntriesParams extends RepositoryParams {
	beforePosition?: number
}

interface FindActiveEntryParams {
	pullRequestId: PullRequestId
}

interface EnqueueEntryParams extends RepositoryParams, FindActiveEntryParams {
	enqueuedBaseSha: string
	enqueuedByUserId: UserId
	enqueuedHeadSha: string
	/** Locked here for the entry's whole life; the queue never re-chooses it. */
	selection: MergeStrategySelection
}

interface RemoveEntryParams extends RepositoryParams, FindActiveEntryParams {
	actorUserId?: UserId
	reason: MergeQueueRemovalReason
}

interface ResumeEntryParams extends RepositoryParams, FindActiveEntryParams {
	actorUserId: UserId
}

/** An entry transition only the holder of the repository's merge lease may make. */
interface LeasedEntryParams {
	entryId: MergeQueueEntryId
	leaseOwner: string
}

interface PauseEntryParams extends LeasedEntryParams {
	actorUserId?: UserId
	blockingReasons: MergeQueueBlockingReasonSnapshot[]
	evaluatedBaseSha?: string
	evaluatedHeadSha?: string
	pullRequestId: PullRequestId
}

interface CompleteWakeupParams extends RepositoryParams {
	requestedVersion: number
}

interface ListWakeupsParams {
	limit: number
	now: Date
}

export type MergeQueueEntryReadModel = MergeQueueEntryRow

/** An entry the worker may run, with the identity the merge is made under. */
export interface MergeQueueRunnableEntry extends MergeQueueEntryReadModel {
	enqueuedBy: { id: UserId; email: string; name: string }
}

/** An entry whose pull request stopped being mergeable behind the queue's back. */
export interface StaleMergeQueueEntry {
	entryId: MergeQueueEntryId
	pullRequestId: PullRequestId
	pullRequestState: 'closed' | 'merged'
	repositoryId: RepositoryId
}

export interface MergeQueueWakeupRequest {
	repositoryId: RepositoryId
	requestedVersion: number
}

/** What a queue mutation changed, and the version to wake the worker with. */
export interface MergeQueueMutationResult {
	entry: MergeQueueEntryReadModel
	requestedVersion: number
}

/**
 * What became of an attempt to join a queue. A pull request that stopped being
 * open is reported apart from one that is already queued: they are different
 * answers to the person who asked, and only one of them is worth retrying.
 */
export type EnqueueMergeQueueEntryResult =
	| ({ status: 'enqueued' } & MergeQueueMutationResult)
	| { status: 'already_queued' }
	| { status: 'pull_request_unavailable' }

/**
 * Queue reads and writes, and the per-repository merge lease.
 *
 * The lease is what makes "one merge at a time per repository" true across the
 * direct merge endpoint and the queue worker, which is why it lives on a durable
 * row with an expiry rather than on a transaction-pinned advisory lock: a
 * process that dies mid-merge must release its hold by aging out, not by holding
 * a connection open until someone notices.
 *
 * PostgreSQL is the queue. Redis only wakes this worker up, so every mutation
 * here commits the change and reports the version a wakeup should carry.
 */
@Injectable()
export class MergeQueueRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Takes the repository's merge lease, or reports that somebody else holds an
	 * unexpired one. Re-acquiring under the same owner renews it, so a caller that
	 * retries its own attempt is never locked out by itself.
	 */
	async acquireRepositoryMergeLease({
		owner,
		repositoryId,
		ttlMs,
	}: AcquireRepositoryMergeLeaseParams): Promise<boolean> {
		await this.db
			.insert(repositoryMergeQueueStates)
			.values({ repositoryId })
			.onConflictDoNothing()

		const [state] = await this.db
			.update(repositoryMergeQueueStates)
			.set({
				leaseOwner: owner,
				leaseAcquiredAt: leaseNow(),
				leaseExpiresAt: leaseDeadline(ttlMs),
			})
			.where(
				and(
					eq(repositoryMergeQueueStates.repositoryId, repositoryId),
					// A free lease, one that has aged out, or this caller's own hold.
					or(
						isNull(repositoryMergeQueueStates.leaseOwner),
						lt(repositoryMergeQueueStates.leaseExpiresAt, leaseNow()),
						eq(repositoryMergeQueueStates.leaseOwner, owner)
					)
				)
			)
			.returning({ repositoryId: repositoryMergeQueueStates.repositoryId })

		return Boolean(state)
	}

	/**
	 * Re-asserts a hold this caller believes it still has, pushing the expiry out.
	 * Reports false when the row no longer says so — the lease aged out, or aged
	 * out and was taken by somebody else — and a caller told that must abandon
	 * whatever it was about to do rather than act on a repository it lost.
	 */
	async renewRepositoryMergeLease({
		owner,
		repositoryId,
		ttlMs,
	}: AcquireRepositoryMergeLeaseParams): Promise<boolean> {
		const [state] = await this.db
			.update(repositoryMergeQueueStates)
			.set({ leaseExpiresAt: leaseDeadline(ttlMs) })
			.where(
				and(
					eq(repositoryMergeQueueStates.repositoryId, repositoryId),
					eq(repositoryMergeQueueStates.leaseOwner, owner),
					gt(repositoryMergeQueueStates.leaseExpiresAt, leaseNow())
				)
			)
			.returning({ repositoryId: repositoryMergeQueueStates.repositoryId })

		return Boolean(state)
	}

	async releaseRepositoryMergeLease({
		owner,
		repositoryId,
	}: ReleaseRepositoryMergeLeaseParams): Promise<void> {
		await this.db
			.update(repositoryMergeQueueStates)
			.set({ leaseOwner: null, leaseAcquiredAt: null, leaseExpiresAt: null })
			.where(
				and(
					eq(repositoryMergeQueueStates.repositoryId, repositoryId),
					eq(repositoryMergeQueueStates.leaseOwner, owner)
				)
			)
	}

	/** The owner of an unexpired lease, if the repository is being merged now. */
	async findRepositoryMergeLeaseOwner({
		repositoryId,
	}: RepositoryParams): Promise<string | undefined> {
		const [state] = await this.db
			.select({ leaseOwner: repositoryMergeQueueStates.leaseOwner })
			.from(repositoryMergeQueueStates)
			.where(
				and(
					eq(repositoryMergeQueueStates.repositoryId, repositoryId),
					gt(repositoryMergeQueueStates.leaseExpiresAt, leaseNow())
				)
			)
			.limit(1)

		return state?.leaseOwner ?? undefined
	}

	async findActiveEntry({
		pullRequestId,
	}: FindActiveEntryParams): Promise<MergeQueueEntryReadModel | undefined> {
		const [entry] = await this.db
			.select(MERGE_QUEUE_ENTRY_COLUMNS)
			.from(mergeQueueEntries)
			.where(
				and(
					eq(mergeQueueEntries.pullRequestId, pullRequestId),
					inArray(mergeQueueEntries.state, [...ACTIVE_MERGE_QUEUE_STATES])
				)
			)
			.limit(1)

		return entry
	}

	/**
	 * How many entries can still run, optionally only those ahead of a position.
	 * Stored positions are never renumbered, so the place a user is shown is
	 * derived from this count rather than read off the column.
	 */
	async countRunnableEntries({
		beforePosition,
		repositoryId,
	}: CountRunnableEntriesParams): Promise<number> {
		const conditions = [
			eq(mergeQueueEntries.repositoryId, repositoryId),
			inArray(mergeQueueEntries.state, [...RUNNABLE_MERGE_QUEUE_STATES]),
		]

		if (beforePosition !== undefined)
			conditions.push(lt(mergeQueueEntries.position, beforePosition))

		const [row] = await this.db
			.select({ count: count() })
			.from(mergeQueueEntries)
			.where(and(...conditions))

		return row?.count ?? 0
	}

	/**
	 * Puts a pull request at the back of its repository's queue.
	 *
	 * Reports `already_queued` when the pull request already holds an active
	 * entry: one pull request is in the queue once, and the partial unique index
	 * says so whether or not this check sees it first.
	 */
	async enqueueEntry({
		enqueuedBaseSha,
		enqueuedByUserId,
		enqueuedHeadSha,
		pullRequestId,
		repositoryId,
		selection,
	}: EnqueueEntryParams): Promise<EnqueueMergeQueueEntryResult> {
		return await this.db.transaction(async tx => {
			await lockMergeQueueState(tx, repositoryId)

			// The queue-state lock orders joins against each other and says nothing
			// about the pull request being joined. Taking its row too is what settles
			// a close that commits while this join is being evaluated: one of the two
			// waits for the other, rather than the close landing between the check
			// and the insert and leaving an active entry on a pull request that is
			// no longer open.
			const [openPullRequest] = await tx
				.select({ id: pullRequests.id })
				.from(pullRequests)
				.where(
					and(
						eq(pullRequests.id, pullRequestId),
						eq(pullRequests.repositoryId, repositoryId),
						eq(pullRequests.state, 'open')
					)
				)
				.limit(1)
				.for('update')

			if (!openPullRequest) return { status: 'pull_request_unavailable' }

			const [existing] = await tx
				.select({ id: mergeQueueEntries.id })
				.from(mergeQueueEntries)
				.where(
					and(
						eq(mergeQueueEntries.pullRequestId, pullRequestId),
						inArray(mergeQueueEntries.state, [...ACTIVE_MERGE_QUEUE_STATES])
					)
				)
				.limit(1)

			if (existing) return { status: 'already_queued' }

			const position = await allocateMergeQueuePosition(tx, repositoryId)
			const [entry] = await tx
				.insert(mergeQueueEntries)
				.values({
					repositoryId,
					pullRequestId,
					position,
					enqueuedByUserId,
					enqueuedBaseSha,
					enqueuedHeadSha,
					strategy: selection.strategy,
					squashTitle:
						selection.strategy === 'squash'
							? (selection.squashTitle ?? null)
							: null,
					squashBody:
						selection.strategy === 'squash'
							? (selection.squashBody ?? null)
							: null,
				})
				.returning(MERGE_QUEUE_ENTRY_COLUMNS)

			if (!entry) return { status: 'already_queued' }

			await tx.insert(pullRequestEvents).values({
				pullRequestId,
				actorUserId: enqueuedByUserId,
				type: 'queue_entered',
				payload: { queueEntryId: entry.id, position, enqueuedHeadSha },
			})

			return {
				status: 'enqueued',
				entry,
				requestedVersion: await requestMergeQueueWakeup(tx, repositoryId),
			}
		})
	}

	/**
	 * Takes a pull request out of the queue.
	 *
	 * The reason is also who asked, and that decides what may be taken out. A
	 * person may not withdraw an entry Git is already merging; a pull request that
	 * closed or merged takes its entry with it from any state at all, because by
	 * then there is nothing left for the entry to wait for either way.
	 */
	async removeEntry({
		actorUserId,
		pullRequestId,
		reason,
		repositoryId,
	}: RemoveEntryParams): Promise<MergeQueueMutationResult | undefined> {
		return await this.db.transaction(async tx => {
			await lockMergeQueueState(tx, repositoryId)

			const entry = await removeActiveMergeQueueEntry(tx, {
				actorUserId,
				pullRequestId,
				reason,
				removableStates: REMOVABLE_STATES_BY_REASON[reason],
			})

			if (!entry) return undefined

			return {
				entry,
				requestedVersion: await requestMergeQueueWakeup(tx, repositoryId),
			}
		})
	}

	/**
	 * Sends a paused entry back to the queue, at the tail.
	 *
	 * It rejoins behind whatever is waiting rather than reclaiming the place it
	 * held: the entries that stayed runnable while this one was parked did not
	 * agree to wait for it to be fixed.
	 */
	async resumeEntry({
		actorUserId,
		pullRequestId,
		repositoryId,
	}: ResumeEntryParams): Promise<MergeQueueMutationResult | undefined> {
		return await this.db.transaction(async tx => {
			await lockMergeQueueState(tx, repositoryId)

			const position = await allocateMergeQueuePosition(tx, repositoryId)
			const changedAt = new Date()
			const [entry] = await tx
				.update(mergeQueueEntries)
				.set({
					state: 'queued',
					position,
					blockingReasons: null,
					pausedAt: null,
					stateChangedAt: changedAt,
				})
				.where(
					and(
						eq(mergeQueueEntries.pullRequestId, pullRequestId),
						eq(mergeQueueEntries.state, 'paused')
					)
				)
				.returning(MERGE_QUEUE_ENTRY_COLUMNS)

			if (!entry) return undefined

			await tx.insert(pullRequestEvents).values({
				pullRequestId,
				actorUserId,
				type: 'queue_resumed',
				payload: { queueEntryId: entry.id, position },
			})

			return {
				entry,
				requestedVersion: await requestMergeQueueWakeup(tx, repositoryId),
			}
		})
	}

	/**
	 * The entry the worker should run next: the one waiting at the front. Paused
	 * entries are skipped rather than blocking, so a pull request nobody can fix
	 * cannot stop the repository from merging anything else.
	 */
	async findNextRunnableEntry({
		repositoryId,
	}: RepositoryParams): Promise<MergeQueueRunnableEntry | undefined> {
		const [entry] = await this.db
			.select({
				...MERGE_QUEUE_ENTRY_COLUMNS,
				enqueuedByEmail: user.email,
				enqueuedByName: user.name,
			})
			.from(mergeQueueEntries)
			.innerJoin(user, eq(user.id, mergeQueueEntries.enqueuedByUserId))
			.where(
				and(
					eq(mergeQueueEntries.repositoryId, repositoryId),
					eq(mergeQueueEntries.state, 'queued')
				)
			)
			.orderBy(asc(mergeQueueEntries.position))
			.limit(1)

		if (!entry) return undefined

		const { enqueuedByEmail, enqueuedByName, ...readModel } = entry

		return {
			...readModel,
			enqueuedBy: {
				id: readModel.enqueuedByUserId,
				email: enqueuedByEmail,
				name: enqueuedByName,
			},
		}
	}

	/**
	 * Puts entries a dead worker left mid-flight back in the queue.
	 *
	 * Only the holder of the repository lease moves entries through `validating`
	 * and `merging`, so a caller that holds it and still sees one is looking at
	 * the wreckage of a previous run. Re-running is safe in both cases: a merge
	 * that reached Git is recognized by its operation trailer and returns the
	 * commit it already made.
	 */
	async resetOrphanedEntries({
		repositoryId,
	}: RepositoryParams): Promise<number> {
		const reset = await this.db
			.update(mergeQueueEntries)
			.set({ state: 'queued', stateChangedAt: new Date() })
			.where(
				and(
					eq(mergeQueueEntries.repositoryId, repositoryId),
					inArray(mergeQueueEntries.state, ['validating', 'merging'])
				)
			)
			.returning({ id: mergeQueueEntries.id })

		return reset.length
	}

	/**
	 * Moves an entry the worker picked up into validation.
	 *
	 * Every transition the worker makes is conditional on the lease it believes it
	 * holds, not merely on the state it believes the entry is in. A run whose
	 * lease aged out has no standing over a repository somebody else may have
	 * taken over, and the two conditions together are what stop it from moving an
	 * entry the new holder is already running.
	 */
	async startValidatingEntry({
		entryId,
		leaseOwner,
	}: LeasedEntryParams): Promise<boolean> {
		const changedAt = new Date()
		const [entry] = await this.db
			.update(mergeQueueEntries)
			.set({
				state: 'validating',
				validatingAt: changedAt,
				stateChangedAt: changedAt,
			})
			.where(
				and(
					eq(mergeQueueEntries.id, entryId),
					eq(mergeQueueEntries.state, 'queued'),
					heldUnderMergeLease(leaseOwner)
				)
			)
			.returning({ id: mergeQueueEntries.id })

		return Boolean(entry)
	}

	/** Moves a validated entry into the merge itself, under the same fence. */
	async startMergingEntry({
		entryId,
		leaseOwner,
	}: LeasedEntryParams): Promise<boolean> {
		const changedAt = new Date()
		const [entry] = await this.db
			.update(mergeQueueEntries)
			.set({
				state: 'merging',
				mergingAt: changedAt,
				stateChangedAt: changedAt,
			})
			.where(
				and(
					eq(mergeQueueEntries.id, entryId),
					eq(mergeQueueEntries.state, 'validating'),
					heldUnderMergeLease(leaseOwner)
				)
			)
			.returning({ id: mergeQueueEntries.id })

		return Boolean(entry)
	}

	/**
	 * Parks an entry with the reasons its evaluation produced. It keeps its row
	 * and stays visible, and only an explicit retry sends it back to the queue.
	 *
	 * Fenced on the lease like the transitions before it: a pause is a verdict
	 * about an evaluation, and a run that has lost the repository is describing a
	 * world that has moved past it.
	 */
	async pauseEntry({
		actorUserId,
		blockingReasons,
		entryId,
		evaluatedBaseSha,
		evaluatedHeadSha,
		leaseOwner,
		pullRequestId,
	}: PauseEntryParams): Promise<boolean> {
		return await this.db.transaction(async tx => {
			const changedAt = new Date()
			const [entry] = await tx
				.update(mergeQueueEntries)
				.set({
					state: 'paused',
					blockingReasons,
					pausedAt: changedAt,
					stateChangedAt: changedAt,
				})
				.where(
					and(
						eq(mergeQueueEntries.id, entryId),
						inArray(mergeQueueEntries.state, ['validating', 'merging']),
						heldUnderMergeLease(leaseOwner)
					)
				)
				.returning({ id: mergeQueueEntries.id })

			if (!entry) return false

			await tx.insert(pullRequestEvents).values({
				pullRequestId,
				actorUserId,
				type: 'queue_paused',
				payload: {
					queueEntryId: entryId,
					reasonCodes: blockingReasons.map(reason => reason.code),
					evaluatedBaseSha,
					evaluatedHeadSha,
				},
			})

			return true
		})
	}

	/** Marks the merge queue entry a run just merged as finished. */
	async completeEntry(entryId: MergeQueueEntryId): Promise<void> {
		await this.db.transaction(tx => completeMergeQueueEntry(tx, entryId))
	}

	/** Raises the repository's queue version and reports what to wake it with. */
	async requestWakeup({ repositoryId }: RepositoryParams): Promise<number> {
		return await this.db.transaction(async tx => {
			await lockMergeQueueState(tx, repositoryId)

			return await requestMergeQueueWakeup(tx, repositoryId)
		})
	}

	/**
	 * Records that a wakeup was served, and reports a version that arrived while
	 * it was being served so the worker can chain a follow-up rather than leave
	 * the change waiting for the reconciler.
	 */
	async completeWakeup({
		repositoryId,
		requestedVersion,
	}: CompleteWakeupParams): Promise<number | undefined> {
		return await this.db.transaction(async tx => {
			const [state] = await tx
				.select({
					requestedVersion: repositoryMergeQueueStates.requestedVersion,
					completedVersion: repositoryMergeQueueStates.completedVersion,
				})
				.from(repositoryMergeQueueStates)
				.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))
				.limit(1)
				.for('update')

			if (!state) return undefined

			const completedVersion = Math.min(
				requestedVersion,
				state.requestedVersion
			)

			if (completedVersion > state.completedVersion)
				await tx
					.update(repositoryMergeQueueStates)
					.set({ completedVersion })
					.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))

			return state.requestedVersion > requestedVersion
				? state.requestedVersion
				: undefined
		})
	}

	/**
	 * Repositories whose queue has work and nothing running it.
	 *
	 * A version still ahead of the completed one is a wakeup that was committed
	 * and then lost, so it is re-sent under the job id it already had; otherwise
	 * the version is raised, which mints a job id no lost delivery can collide
	 * with.
	 */
	async listWakeups({
		limit,
		now,
	}: ListWakeupsParams): Promise<MergeQueueWakeupRequest[]> {
		return await this.db.transaction(async tx => {
			const states = await tx
				.select({
					repositoryId: repositoryMergeQueueStates.repositoryId,
					requestedVersion: repositoryMergeQueueStates.requestedVersion,
					completedVersion: repositoryMergeQueueStates.completedVersion,
				})
				.from(repositoryMergeQueueStates)
				.where(
					and(
						or(
							isNull(repositoryMergeQueueStates.leaseOwner),
							lte(repositoryMergeQueueStates.leaseExpiresAt, now)
						),
						sql`exists (
							select 1 from ${mergeQueueEntries}
							where ${mergeQueueEntries.repositoryId} = ${repositoryMergeQueueStates.repositoryId}
								and ${mergeQueueEntries.state} in ('queued', 'validating', 'merging')
						)`
					)
				)
				.orderBy(asc(repositoryMergeQueueStates.updatedAt))
				.limit(limit)
				.for('update', { skipLocked: true })

			const wakeups: MergeQueueWakeupRequest[] = []

			for (const state of states) {
				if (state.requestedVersion > state.completedVersion) {
					wakeups.push({
						repositoryId: state.repositoryId,
						requestedVersion: state.requestedVersion,
					})
					continue
				}

				wakeups.push({
					repositoryId: state.repositoryId,
					requestedVersion: await requestMergeQueueWakeup(
						tx,
						state.repositoryId
					),
				})
			}

			return wakeups
		})
	}

	/**
	 * Entries whose pull request is no longer open. Closing and merging both
	 * terminalize the entry in their own transaction, so anything found here was
	 * closed by a path that does not go through them — a mirror synchronization,
	 * most of all.
	 */
	async listEntriesForInactivePullRequests({
		limit,
	}: {
		limit: number
	}): Promise<StaleMergeQueueEntry[]> {
		const rows = await this.db
			.select({
				entryId: mergeQueueEntries.id,
				pullRequestId: mergeQueueEntries.pullRequestId,
				pullRequestState: pullRequests.state,
				repositoryId: mergeQueueEntries.repositoryId,
			})
			.from(mergeQueueEntries)
			.innerJoin(
				pullRequests,
				eq(pullRequests.id, mergeQueueEntries.pullRequestId)
			)
			.where(
				and(
					inArray(mergeQueueEntries.state, [...ACTIVE_MERGE_QUEUE_STATES]),
					ne(pullRequests.state, 'open')
				)
			)
			.orderBy(asc(mergeQueueEntries.enqueuedAt))
			.limit(limit)

		return rows.flatMap(row =>
			row.pullRequestState === 'open'
				? []
				: [{ ...row, pullRequestState: row.pullRequestState }]
		)
	}
}

/**
 * Every lease timestamp is the database's own clock rather than the caller's.
 * Two API instances competing for one repository must agree on whether a lease
 * has expired, and a skewed clock on either of them would otherwise let one
 * steal a lease the other still holds.
 */
function leaseNow() {
	return sql`now()`
}

function leaseDeadline(ttlMs: number) {
	return sql`now() + ${ttlMs} * interval '1 millisecond'`
}
