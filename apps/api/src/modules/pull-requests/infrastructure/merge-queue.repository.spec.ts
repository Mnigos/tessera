import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	and,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	mergeQueueEntries,
	or,
	pullRequestEvents,
	pullRequests,
	repositoryMergeQueueStates,
	sql,
} from '@repo/db'
import type {
	MergeQueueEntryId,
	MergeQueueState,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	type MergeQueueEntryReadModel,
	MergeQueueRepository,
} from './merge-queue.repository'
import { heldUnderMergeLease } from './merge-queue.transactions'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const entryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const enqueuedAt = new Date('2026-07-11T00:00:00Z')
const entry: MergeQueueEntryReadModel = {
	id: entryId,
	pullRequestId,
	position: 7,
	state: 'queued',
	blockingReasons: null,
	enqueuedByUserId: mockUserId,
	enqueuedAt,
	stateChangedAt: enqueuedAt,
}

/**
 * A Drizzle builder that answers whatever the test queued for the table it was
 * addressed to. Every chain method returns the builder itself and the builder
 * is awaitable, so one object stands in for a count, a row read and an update
 * with a `returning` clause alike.
 */
function createDatabaseMock() {
	const rowsByTable = new Map<unknown, unknown[][]>()
	const calls: { table: unknown; method: string; argument: unknown }[] = []

	function nextRows(table: unknown): unknown[] {
		const queued = rowsByTable.get(table)

		if (!queued || queued.length === 0) return []

		return (queued.length === 1 ? queued[0] : queued.shift()) ?? []
	}

	function createBuilder(initialTable?: unknown) {
		const state = { table: initialTable }
		const builder: Record<string, unknown> = {}
		const methods = [
			'from',
			'innerJoin',
			'leftJoin',
			'where',
			'orderBy',
			'limit',
			'for',
			'set',
			'values',
			'onConflictDoNothing',
			'returning',
		]

		for (const method of methods)
			builder[method] = vi.fn((argument: unknown) => {
				if (method === 'from') state.table = argument

				calls.push({ table: state.table, method, argument })

				return builder
			})

		// biome-ignore lint/suspicious/noThenProperty: a Drizzle builder is awaited as well as chained, so the stand-in has to be both
		builder.then = (
			resolve: (rows: unknown[]) => unknown,
			reject: (error: unknown) => unknown
		) => Promise.resolve(nextRows(state.table)).then(resolve, reject)

		return builder
	}

	const database = {
		select: vi.fn(() => createBuilder()),
		insert: vi.fn((table: unknown) => createBuilder(table)),
		update: vi.fn((table: unknown) => createBuilder(table)),
		transaction: vi.fn((callback: (tx: unknown) => unknown) =>
			callback(database)
		),
	}

	return {
		database,
		queueRows(table: unknown, ...rows: unknown[][]) {
			rowsByTable.set(table, rows)
		},
		findCall(table: unknown, method: string) {
			return calls.find(call => call.table === table && call.method === method)
		},
	}
}

describe(MergeQueueRepository.name, () => {
	let moduleRef: TestingModule
	let repository: MergeQueueRepository
	let db: ReturnType<typeof createDatabaseMock>

	beforeEach(async () => {
		db = createDatabaseMock()
		db.queueRows(repositoryMergeQueueStates, [{ repositoryId }])

		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueueRepository,
				{ provide: Database, useValue: db.database },
			],
		}).compile()
		repository = moduleRef.get(MergeQueueRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('takes a lease that is free, expired, or its own', async () => {
		expect(
			await repository.acquireRepositoryMergeLease({
				repositoryId,
				owner: 'attempt-1',
				ttlMs: 120_000,
			})
		).toBeTruthy()
		// The database clock decides expiry, so neither timestamp comes from this
		// process: two instances competing for one repository have to agree.
		expect(db.findCall(repositoryMergeQueueStates, 'set')?.argument).toEqual({
			leaseOwner: 'attempt-1',
			leaseAcquiredAt: sql`now()`,
			leaseExpiresAt: sql`now() + ${120_000} * interval '1 millisecond'`,
		})
		expect(db.findCall(repositoryMergeQueueStates, 'where')?.argument).toEqual(
			and(
				eq(repositoryMergeQueueStates.repositoryId, repositoryId),
				or(
					isNull(repositoryMergeQueueStates.leaseOwner),
					lt(repositoryMergeQueueStates.leaseExpiresAt, sql`now()`),
					eq(repositoryMergeQueueStates.leaseOwner, 'attempt-1')
				)
			)
		)
	})

	test('reports a lease somebody else still holds as unavailable', async () => {
		db.queueRows(repositoryMergeQueueStates, [])

		expect(
			await repository.acquireRepositoryMergeLease({
				repositoryId,
				owner: 'attempt-2',
				ttlMs: 120_000,
			})
		).toBeFalsy()
	})

	test('creates the queue state row before competing for its lease', async () => {
		await repository.acquireRepositoryMergeLease({
			repositoryId,
			owner: 'attempt-1',
			ttlMs: 120_000,
		})

		expect(db.database.insert).toHaveBeenCalledWith(repositoryMergeQueueStates)

		const [insertOrder = 0] = db.database.insert.mock.invocationCallOrder
		const [updateOrder = 0] = db.database.update.mock.invocationCallOrder

		expect(insertOrder).toBeLessThan(updateOrder)
	})

	test('releases only the lease this caller holds', async () => {
		await repository.releaseRepositoryMergeLease({
			repositoryId,
			owner: 'attempt-1',
		})

		expect(db.findCall(repositoryMergeQueueStates, 'set')?.argument).toEqual({
			leaseOwner: null,
			leaseAcquiredAt: null,
			leaseExpiresAt: null,
		})
		expect(db.findCall(repositoryMergeQueueStates, 'where')?.argument).toEqual(
			and(
				eq(repositoryMergeQueueStates.repositoryId, repositoryId),
				eq(repositoryMergeQueueStates.leaseOwner, 'attempt-1')
			)
		)
	})

	test('reports no owner when the stored lease has aged out', async () => {
		db.queueRows(repositoryMergeQueueStates, [])

		expect(
			await repository.findRepositoryMergeLeaseOwner({ repositoryId })
		).toBeUndefined()
	})

	test('names the owner of an unexpired lease', async () => {
		db.queueRows(repositoryMergeQueueStates, [{ leaseOwner: 'attempt-9' }])

		expect(
			await repository.findRepositoryMergeLeaseOwner({ repositoryId })
		).toBe('attempt-9')
	})

	// Renewing only pushes the expiry out. Touching the owner would let a caller
	// whose hold aged out write itself back onto a row somebody else now holds.
	test('extends a lease this caller still holds without reassigning it', async () => {
		expect(
			await repository.renewRepositoryMergeLease({
				repositoryId,
				owner: 'attempt-1',
				ttlMs: 120_000,
			})
		).toBeTruthy()
		expect(db.findCall(repositoryMergeQueueStates, 'set')?.argument).toEqual({
			leaseExpiresAt: sql`now() + ${120_000} * interval '1 millisecond'`,
		})
		expect(db.findCall(repositoryMergeQueueStates, 'where')?.argument).toEqual(
			and(
				eq(repositoryMergeQueueStates.repositoryId, repositoryId),
				eq(repositoryMergeQueueStates.leaseOwner, 'attempt-1'),
				gt(repositoryMergeQueueStates.leaseExpiresAt, sql`now()`)
			)
		)
	})

	test('reports a lease that aged out as no longer this caller’s', async () => {
		db.queueRows(repositoryMergeQueueStates, [])

		expect(
			await repository.renewRepositoryMergeLease({
				repositoryId,
				owner: 'attempt-1',
				ttlMs: 120_000,
			})
		).toBeFalsy()
	})

	test('finds the entry a pull request is still in the queue with', async () => {
		db.queueRows(mergeQueueEntries, [entry])

		expect(await repository.findActiveEntry({ pullRequestId })).toEqual(entry)
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.pullRequestId, pullRequestId),
				inArray(mergeQueueEntries.state, [
					'queued',
					'validating',
					'merging',
					'paused',
				])
			)
		)
	})

	test('finds no entry once the pull request left the queue', async () => {
		expect(await repository.findActiveEntry({ pullRequestId })).toBeUndefined()
	})

	// `paused` is deliberately absent: a paused entry belongs to the queue and is
	// shown, but nothing is waiting behind it, so it counts toward nobody's place.
	test('counts only the entries that can still run', async () => {
		db.queueRows(mergeQueueEntries, [{ count: 4 }])

		expect(await repository.countRunnableEntries({ repositoryId })).toBe(4)
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.repositoryId, repositoryId),
				inArray(mergeQueueEntries.state, ['queued', 'validating', 'merging'])
			)
		)
	})

	test('counts the runnable entries ahead of a position', async () => {
		db.queueRows(mergeQueueEntries, [{ count: 2 }])

		expect(
			await repository.countRunnableEntries({ repositoryId, beforePosition: 7 })
		).toBe(2)
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.repositoryId, repositoryId),
				inArray(mergeQueueEntries.state, ['queued', 'validating', 'merging']),
				lt(mergeQueueEntries.position, 7)
			)
		)
	})

	// Asking for the entries before position zero is asking for none of them, and
	// that is a different question from asking for all of them — the bound has to
	// be applied rather than dropped for being falsy.
	test('applies a position bound of zero rather than ignoring it', async () => {
		await repository.countRunnableEntries({ repositoryId, beforePosition: 0 })

		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.repositoryId, repositoryId),
				inArray(mergeQueueEntries.state, ['queued', 'validating', 'merging']),
				lt(mergeQueueEntries.position, 0)
			)
		)
	})

	test('reports an empty queue as nothing runnable', async () => {
		expect(await repository.countRunnableEntries({ repositoryId })).toBe(0)
	})

	// Positions are allocated behind the highest one the repository has ever used
	// rather than behind the highest one still active, so no place is handed out
	// twice and nothing is renumbered.
	test('enqueues behind the highest position the repository has used', async () => {
		db.queueRows(pullRequests, [{ id: pullRequestId }])
		db.queueRows(
			mergeQueueEntries,
			[],
			[{ highest: 11 }],
			[{ ...entry, position: 12 }]
		)
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId }],
			[{ requestedVersion: 5 }]
		)

		expect(
			await repository.enqueueEntry({
				repositoryId,
				pullRequestId,
				enqueuedByUserId: mockUserId,
				enqueuedBaseSha: 'a'.repeat(40),
				enqueuedHeadSha: 'b'.repeat(40),
			})
		).toEqual({
			status: 'enqueued',
			entry: { ...entry, position: 12 },
			requestedVersion: 5,
		})
		expect(db.findCall(mergeQueueEntries, 'values')?.argument).toMatchObject({
			position: 12,
			enqueuedByUserId: mockUserId,
		})
		expect(db.findCall(pullRequestEvents, 'values')?.argument).toMatchObject({
			pullRequestId,
			type: 'queue_entered',
			payload: { position: 12, enqueuedHeadSha: 'b'.repeat(40) },
		})
	})

	// The queue-state lock orders joins against each other and says nothing about
	// the pull request being joined, so the pull request's own row is taken too.
	test('takes the pull request row it is queueing for the transaction', async () => {
		db.queueRows(pullRequests, [{ id: pullRequestId }])
		db.queueRows(mergeQueueEntries, [], [{ highest: 1 }], [entry])
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId }],
			[{ requestedVersion: 2 }]
		)

		await repository.enqueueEntry({
			repositoryId,
			pullRequestId,
			enqueuedByUserId: mockUserId,
			enqueuedBaseSha: 'a'.repeat(40),
			enqueuedHeadSha: 'b'.repeat(40),
		})

		expect(db.findCall(pullRequests, 'for')?.argument).toBe('update')
		expect(db.findCall(pullRequests, 'where')?.argument).toEqual(
			and(
				eq(pullRequests.id, pullRequestId),
				eq(pullRequests.repositoryId, repositoryId),
				eq(pullRequests.state, 'open')
			)
		)
	})

	// A close that commits while the join is being evaluated wins outright: the
	// locked read finds no open pull request, and nothing is written at all.
	test('enqueues nothing for a pull request that stopped being open', async () => {
		db.queueRows(pullRequests, [])

		expect(
			await repository.enqueueEntry({
				repositoryId,
				pullRequestId,
				enqueuedByUserId: mockUserId,
				enqueuedBaseSha: 'a'.repeat(40),
				enqueuedHeadSha: 'b'.repeat(40),
			})
		).toEqual({ status: 'pull_request_unavailable' })
		expect(db.findCall(mergeQueueEntries, 'values')).toBeUndefined()
		expect(db.findCall(pullRequestEvents, 'values')).toBeUndefined()
	})

	// The partial unique index says the same thing, but reporting it as a decision
	// rather than as a constraint violation keeps the conflict readable.
	test('refuses to enqueue a pull request that already holds an entry', async () => {
		db.queueRows(pullRequests, [{ id: pullRequestId }])
		db.queueRows(mergeQueueEntries, [{ id: entryId }])

		expect(
			await repository.enqueueEntry({
				repositoryId,
				pullRequestId,
				enqueuedByUserId: mockUserId,
				enqueuedBaseSha: 'a'.repeat(40),
				enqueuedHeadSha: 'b'.repeat(40),
			})
		).toEqual({ status: 'already_queued' })
		expect(db.findCall(pullRequestEvents, 'values')).toBeUndefined()
	})

	test('records why an entry left the queue', async () => {
		db.queueRows(mergeQueueEntries, [{ ...entry, state: 'removed' }])
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId }],
			[{ requestedVersion: 3 }]
		)

		expect(
			await repository.removeEntry({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				reason: 'admin',
			})
		).toMatchObject({ requestedVersion: 3 })
		expect(db.findCall(pullRequestEvents, 'values')?.argument).toMatchObject({
			type: 'queue_removed',
			payload: { queueEntryId: entryId, position: 7, reason: 'admin' },
		})
	})

	// Nobody withdraws an entry Git already has the branch for. A pull request
	// that closed or merged takes its entry with it from any state, because by
	// then the entry has nothing left to wait for either way.
	test.each([
		{
			reason: 'user' as const,
			states: ['queued', 'validating', 'paused'] satisfies MergeQueueState[],
		},
		{
			reason: 'admin' as const,
			states: ['queued', 'validating', 'paused'] satisfies MergeQueueState[],
		},
		{
			reason: 'closed' as const,
			states: [
				'queued',
				'validating',
				'merging',
				'paused',
			] satisfies MergeQueueState[],
		},
		{
			reason: 'merged' as const,
			states: [
				'queued',
				'validating',
				'merging',
				'paused',
			] satisfies MergeQueueState[],
		},
	])('removes an entry for $reason from $states', async ({
		reason,
		states,
	}) => {
		db.queueRows(mergeQueueEntries, [{ ...entry, state: 'removed' }])
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId }],
			[{ requestedVersion: 3 }]
		)

		await repository.removeEntry({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			reason,
		})

		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.pullRequestId, pullRequestId),
				inArray(mergeQueueEntries.state, states)
			)
		)
	})

	// A resumed entry rejoins at the tail: whatever stayed runnable while it was
	// parked did not agree to wait for it to be fixed.
	test('sends a resumed entry to the back of the queue', async () => {
		db.queueRows(
			mergeQueueEntries,
			[{ highest: 20 }],
			[{ ...entry, position: 21 }]
		)
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId }],
			[{ requestedVersion: 8 }]
		)

		expect(
			await repository.resumeEntry({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
			})
		).toMatchObject({ requestedVersion: 8 })
		expect(db.findCall(mergeQueueEntries, 'set')?.argument).toMatchObject({
			state: 'queued',
			position: 21,
			blockingReasons: null,
			pausedAt: null,
		})
		expect(db.findCall(pullRequestEvents, 'values')?.argument).toMatchObject({
			type: 'queue_resumed',
			payload: { queueEntryId: entryId, position: 21 },
		})
	})

	test('reports resuming an entry that is not paused', async () => {
		db.queueRows(mergeQueueEntries, [{ highest: 3 }], [])

		expect(
			await repository.resumeEntry({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
			})
		).toBeUndefined()
	})

	test.each([
		{
			transition: 'startValidatingEntry' as const,
			from: 'queued' as const,
			to: 'validating' as const,
		},
		{
			transition: 'startMergingEntry' as const,
			from: 'validating' as const,
			to: 'merging' as const,
		},
	])('moves an entry to $to only from the state it expects it in', async ({
		from,
		to,
		transition,
	}) => {
		db.queueRows(mergeQueueEntries, [{ id: entryId }])

		expect(
			await repository[transition]({ entryId, leaseOwner: 'attempt-1' })
		).toBeTruthy()
		expect(db.findCall(mergeQueueEntries, 'set')?.argument).toMatchObject({
			state: to,
		})
		// The state it expects and the lease it holds, both: a run whose hold aged
		// out has no standing over an entry the next holder may already be running.
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.id, entryId),
				eq(mergeQueueEntries.state, from),
				heldUnderMergeLease('attempt-1')
			)
		)
	})

	// A duplicate wakeup finds the entry already moved on, which is what makes a
	// repeated delivery cost nothing.
	test('reports a transition somebody else already made', async () => {
		expect(
			await repository.startValidatingEntry({
				entryId,
				leaseOwner: 'attempt-1',
			})
		).toBeFalsy()
	})

	test('parks an entry with the reasons that stopped it', async () => {
		db.queueRows(mergeQueueEntries, [{ id: entryId }])

		expect(
			await repository.pauseEntry({
				entryId,
				leaseOwner: 'attempt-1',
				pullRequestId,
				blockingReasons: [{ code: 'threads_unresolved', count: 2 }],
				evaluatedBaseSha: 'a'.repeat(40),
				evaluatedHeadSha: 'b'.repeat(40),
			})
		).toBeTruthy()
		expect(db.findCall(mergeQueueEntries, 'set')?.argument).toMatchObject({
			state: 'paused',
			blockingReasons: [{ code: 'threads_unresolved', count: 2 }],
		})
		expect(db.findCall(pullRequestEvents, 'values')?.argument).toMatchObject({
			type: 'queue_paused',
			payload: {
				queueEntryId: entryId,
				reasonCodes: ['threads_unresolved'],
				evaluatedBaseSha: 'a'.repeat(40),
				evaluatedHeadSha: 'b'.repeat(40),
			},
		})
	})

	test('returns entries a dead run left mid-flight to the queue', async () => {
		db.queueRows(mergeQueueEntries, [{ id: entryId }, { id: entryId }])

		expect(await repository.resetOrphanedEntries({ repositoryId })).toBe(2)
		expect(db.findCall(mergeQueueEntries, 'set')?.argument).toMatchObject({
			state: 'queued',
		})
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.repositoryId, repositoryId),
				inArray(mergeQueueEntries.state, ['validating', 'merging'])
			)
		)
	})

	test('runs the waiting entry with the lowest position next', async () => {
		db.queueRows(mergeQueueEntries, [
			{ ...entry, enqueuedByEmail: 'ada@example.com', enqueuedByName: 'Ada' },
		])

		expect(
			await repository.findNextRunnableEntry({ repositoryId })
		).toMatchObject({
			id: entryId,
			enqueuedBy: { id: mockUserId, email: 'ada@example.com', name: 'Ada' },
		})
		expect(db.findCall(mergeQueueEntries, 'where')?.argument).toEqual(
			and(
				eq(mergeQueueEntries.repositoryId, repositoryId),
				eq(mergeQueueEntries.state, 'queued')
			)
		)
	})

	// A version that arrived while the run was serving an older one is what the
	// worker chains a follow-up on rather than leaving to the reconciler.
	test('reports a version requested while the wakeup was being served', async () => {
		db.queueRows(repositoryMergeQueueStates, [
			{ requestedVersion: 9, completedVersion: 4 },
		])

		expect(
			await repository.completeWakeup({ repositoryId, requestedVersion: 6 })
		).toBe(9)
		expect(db.findCall(repositoryMergeQueueStates, 'set')?.argument).toEqual({
			completedVersion: 6,
		})
	})

	test('reports no follow-up when nothing was requested meanwhile', async () => {
		db.queueRows(repositoryMergeQueueStates, [
			{ requestedVersion: 6, completedVersion: 4 },
		])

		expect(
			await repository.completeWakeup({ repositoryId, requestedVersion: 6 })
		).toBeUndefined()
	})

	// The wakeup was committed and its delivery lost, so it is re-sent under the
	// job id it already had rather than minting a second one for the same work.
	test('re-sends a wakeup the queue is still owed', async () => {
		db.queueRows(repositoryMergeQueueStates, [
			{ repositoryId, requestedVersion: 9, completedVersion: 4 },
		])

		expect(
			await repository.listWakeups({ limit: 25, now: new Date() })
		).toEqual([{ repositoryId, requestedVersion: 9 }])
		expect(db.findCall(repositoryMergeQueueStates, 'set')).toBeUndefined()
	})

	// Nothing is outstanding, so the version is raised: the job id that produces
	// is one no lost delivery can already be holding.
	test('raises the version for a repository nothing is running', async () => {
		db.queueRows(
			repositoryMergeQueueStates,
			[{ repositoryId, requestedVersion: 4, completedVersion: 4 }],
			[{ requestedVersion: 5 }]
		)

		expect(
			await repository.listWakeups({ limit: 25, now: new Date() })
		).toEqual([{ repositoryId, requestedVersion: 5 }])
	})

	test('finds entries whose pull request stopped being open', async () => {
		db.queueRows(mergeQueueEntries, [
			{ entryId, pullRequestId, pullRequestState: 'merged', repositoryId },
		])

		expect(
			await repository.listEntriesForInactivePullRequests({ limit: 25 })
		).toEqual([
			{ entryId, pullRequestId, pullRequestState: 'merged', repositoryId },
		])
	})
})
