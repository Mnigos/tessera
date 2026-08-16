import { Database } from '@config/database'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubActorId } from '@repo/db'
import {
	asc,
	gitHubPullRequestMappings,
	mergeQueueEntries,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositoryMergeQueueStates,
	repositoryPullRequestCounters,
	sql,
} from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { PgDialect } from 'drizzle-orm/pg-core'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestsRepository } from './pull-requests.repository'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const anotherRepositoryId =
	'00000000-0000-4000-8000-000000000003' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const gitHubActorId = '00000000-0000-4000-8000-000000000055' as GitHubActorId
const createdAt = new Date('2026-07-11T00:00:00Z')
const NO_LONGER_MERGING_REGEX = /no longer merging/
const mergeRequest = {
	strategy: 'merge_commit' as const,
	expectedBaseSha: 'a'.repeat(40),
	expectedHeadSha: 'b'.repeat(40),
	commitMessage: 'Merge pull request #1: Add feature',
}
const mergeRequestColumns = {
	strategy: 'merge_commit',
	expectedBaseSha: 'a'.repeat(40),
	expectedHeadSha: 'b'.repeat(40),
	commitMessage: 'Merge pull request #1: Add feature',
	squashTitle: null,
	squashBody: null,
}
const pullRequest = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera' as const,
	number: 1,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'head-sha',
	title: 'Add feature',
	body: '',
	state: 'open' as const,
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
	githubNodeId: null,
	githubHtmlUrl: null,
	githubDraft: null,
	githubHeadSha: null,
	githubBaseSha: null,
	githubMergedByUsername: null,
}
const event = {
	id: '00000000-0000-4000-8000-000000000045' as PullRequestEventId,
	pullRequestId,
	provider: 'tessera' as const,
	actorUserId: mockUserId,
	actorUsername: 'marta',
	type: 'opened' as const,
	createdAt,
}
const gitHubPullRequest: GitHubSyncPullRequest = {
	nodeId: 'pull-request-node',
	numericId: 7n,
	number: 7,
	htmlUrl: 'https://github.com/tessera/notes/pull/7',
	title: 'Imported pull request',
	body: '',
	state: 'open',
	draft: false,
	author: {
		nodeId: 'actor-node',
		numericId: 9n,
		login: 'marta',
		type: 'user',
	},
	sourceBranch: 'feature',
	targetBranch: 'main',
	baseRepositoryNodeId: 'repository-node',
	headSha: 'head-sha',
	baseSha: 'base-sha',
	createdAt,
	updatedAt: createdAt,
}

describe(PullRequestsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestsRepository

	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const selectFromMock = vi.fn()
	const selectLeftJoinMock = vi.fn()
	const selectWhereMock = vi.fn()
	const selectOrderByMock = vi.fn()
	const selectLimitMock = vi.fn()
	const selectForMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	const counterValuesMock = vi.fn()
	const counterConflictMock = vi.fn()
	const pullRequestValuesMock = vi.fn()
	const mergeIntentValuesMock = vi.fn()
	const pullRequestReturningMock = vi.fn()
	const eventValuesMock = vi.fn()
	const mappingValuesMock = vi.fn()
	const mappingConflictMock = vi.fn()
	const eventMappingFindMock = vi.fn()
	const counterUpdateSetMock = vi.fn()
	const counterUpdateWhereMock = vi.fn()
	const counterUpdateReturningMock = vi.fn()
	const pullRequestUpdateSetMock = vi.fn()
	const pullRequestUpdateWhereMock = vi.fn()
	const pullRequestUpdateReturningMock = vi.fn()
	const mergeIntentUpdateSetMock = vi.fn()
	const mergeIntentUpdateWhereMock = vi.fn()
	const queueEntryUpdateSetMock = vi.fn()
	const queueEntryUpdateWhereMock = vi.fn()
	const queueEntryUpdateReturningMock = vi.fn()
	const deleteMock = vi.fn()
	const deleteWhereMock = vi.fn()
	const executeMock = vi.fn()

	beforeEach(async () => {
		selectOrderByMock.mockResolvedValue([pullRequest])
		selectLimitMock.mockResolvedValue([pullRequest])
		selectForMock.mockResolvedValue([pullRequest])
		selectWhereMock.mockReturnValue({
			orderBy: selectOrderByMock,
			limit: selectLimitMock,
			for: selectForMock,
		})
		const joinedSelect = {
			leftJoin: selectLeftJoinMock,
			where: selectWhereMock,
		}
		selectLeftJoinMock.mockReturnValue(joinedSelect)
		selectFromMock.mockReturnValue(joinedSelect)
		selectMock.mockReturnValue({ from: selectFromMock })

		counterConflictMock.mockResolvedValue(undefined)
		counterValuesMock.mockReturnValue({
			onConflictDoNothing: counterConflictMock,
		})
		pullRequestReturningMock.mockResolvedValue([pullRequest])
		pullRequestValuesMock.mockReturnValue({
			returning: pullRequestReturningMock,
		})
		mergeIntentValuesMock.mockResolvedValue(undefined)
		eventValuesMock.mockResolvedValue(undefined)
		mappingConflictMock.mockResolvedValue(undefined)
		// Lifecycle events are already recorded, so reconciliation appends none and
		// the mapping upsert is what these tests are about.
		eventMappingFindMock.mockResolvedValue({ id: 'event-mapping' })
		mappingValuesMock.mockReturnValue({
			onConflictDoUpdate: mappingConflictMock,
		})
		insertMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { values: counterValuesMock }
			if (table === pullRequests) return { values: pullRequestValuesMock }
			if (table === pullRequestMergeIntents)
				return { values: mergeIntentValuesMock }
			if (table === gitHubPullRequestMappings)
				return { values: mappingValuesMock }

			return { values: eventValuesMock }
		})

		counterUpdateReturningMock.mockResolvedValue([{ nextNumber: 2 }])
		counterUpdateWhereMock.mockReturnValue({
			returning: counterUpdateReturningMock,
		})
		counterUpdateSetMock.mockReturnValue({ where: counterUpdateWhereMock })
		pullRequestUpdateReturningMock.mockResolvedValue([pullRequest])
		pullRequestUpdateWhereMock.mockReturnValue({
			returning: pullRequestUpdateReturningMock,
		})
		pullRequestUpdateSetMock.mockReturnValue({
			where: pullRequestUpdateWhereMock,
		})
		mergeIntentUpdateWhereMock.mockResolvedValue(undefined)
		mergeIntentUpdateSetMock.mockReturnValue({
			where: mergeIntentUpdateWhereMock,
		})
		// No queue entry unless a test says otherwise: most pull requests were never
		// queued, and the lifecycle paths must behave the same either way.
		queueEntryUpdateReturningMock.mockResolvedValue([])
		queueEntryUpdateWhereMock.mockReturnValue({
			returning: queueEntryUpdateReturningMock,
		})
		queueEntryUpdateSetMock.mockReturnValue({
			where: queueEntryUpdateWhereMock,
		})
		updateMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { set: counterUpdateSetMock }
			if (table === pullRequestMergeIntents)
				return { set: mergeIntentUpdateSetMock }
			if (table === mergeQueueEntries) return { set: queueEntryUpdateSetMock }

			return { set: pullRequestUpdateSetMock }
		})
		deleteWhereMock.mockResolvedValue(undefined)
		deleteMock.mockReturnValue({ where: deleteWhereMock })
		const tx = {
			delete: deleteMock,
			execute: executeMock,
			insert: insertMock,
			select: selectMock,
			update: updateMock,
			query: {
				gitHubPullRequestEventMappings: { findFirst: eventMappingFindMock },
			},
		}
		transactionMock.mockImplementation(callback => callback(tx))

		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestsRepository,
				{
					provide: Database,
					useValue: {
						delete: deleteMock,
						transaction: transactionMock,
						select: selectMock,
					},
				},
			],
		}).compile()

		repository = moduleRef.get(PullRequestsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('allocates a repository-scoped number and records an opened event', async () => {
		expect(
			await repository.create({
				repositoryId,
				authorUserId: mockUserId,
				sourceBranch: 'feature',
				targetBranch: 'main',
				openingBaseSha: 'base-sha',
				openingHeadSha: 'head-sha',
				title: 'Add feature',
				body: '',
			})
		).toEqual(pullRequest)
		expect(insertMock).toHaveBeenCalledWith(repositoryPullRequestCounters)
		expect(insertMock).toHaveBeenCalledWith(pullRequests)
		expect(insertMock).toHaveBeenCalledWith(pullRequestEvents)
		expect(pullRequestValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ number: 1, repositoryId })
		)
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'opened',
		})
	})

	test('lists repository pull requests', async () => {
		expect(await repository.list({ repositoryId, state: 'open' })).toEqual([
			expect.objectContaining({
				id: pullRequestId,
				provider: 'tessera',
				authorUsername: 'marta',
				github: undefined,
			}),
		])
		expect(selectOrderByMock).toHaveBeenCalled()
	})

	test('finds a repository-scoped pull request number', async () => {
		expect(await repository.find({ repositoryId, number: 1 })).toEqual(
			expect.objectContaining({
				id: pullRequestId,
				provider: 'tessera',
				authorUsername: 'marta',
				github: undefined,
			})
		)
		expect(selectLimitMock).toHaveBeenCalledWith(1)
	})

	test('returns undefined when the counter repository is missing', async () => {
		counterUpdateReturningMock.mockResolvedValue([])

		expect(
			await repository.create({
				repositoryId,
				authorUserId: mockUserId,
				sourceBranch: 'feature',
				targetBranch: 'main',
				openingBaseSha: 'base-sha',
				openingHeadSha: 'head-sha',
				title: 'Add feature',
				body: '',
			})
		).toBeUndefined()
		expect(pullRequestValuesMock).not.toHaveBeenCalled()
	})

	// `merged` and `merge_bypassed` are written in one transaction and share its
	// timestamp, so creation time alone would leave their order to the planner.
	// The waiver explains the merge and is placed first; the id settles the rest.
	test('returns lifecycle events in an order that cannot reshuffle', async () => {
		selectOrderByMock.mockResolvedValue([event])

		expect(await repository.listEvents({ pullRequestId })).toEqual([event])
		expect(selectOrderByMock).toHaveBeenCalledWith(
			asc(pullRequestEvents.createdAt),
			sql`case when ${pullRequestEvents.type} = 'merge_bypassed' then 0 else 1 end`,
			asc(pullRequestEvents.id)
		)

		const [, tiebreak] = selectOrderByMock.mock.calls[0] ?? []
		expect(new PgDialect().sqlToQuery(tiebreak).sql).toBe(
			`case when "pull_request_events"."type" = 'merge_bypassed' then 0 else 1 end`
		)
	})

	test('rejects a GitHub mapping owned by another repository before creating a pull request', async () => {
		selectLimitMock.mockReturnValue({ for: selectForMock })
		selectForMock.mockResolvedValue([
			{ pullRequestId, repositoryId: anotherRepositoryId },
		])

		await expect(
			repository.reconcileGitHubPullRequest({
				repositoryId,
				pullRequest: gitHubPullRequest,
				authorActorId: gitHubActorId,
				pendingEvents: [],
			})
		).rejects.toThrow(
			'GitHub pull request mapping belongs to another repository'
		)
		expect(pullRequestValuesMock).not.toHaveBeenCalled()
		expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
		expect(executeMock).toHaveBeenCalledOnce()
	})

	test('clears the checks cursor when a reconciled head moves', async () => {
		selectLimitMock.mockReturnValue({ for: selectForMock })
		selectForMock.mockResolvedValue([{ pullRequestId, repositoryId }])

		await repository.reconcileGitHubPullRequest({
			repositoryId,
			pullRequest: { ...gitHubPullRequest, headSha: 'moved-head' },
			authorActorId: gitHubActorId,
			pendingEvents: [],
		})

		const [upsert] = mappingConflictMock.mock.calls.at(0) ?? []
		const cursor = new PgDialect().sqlToQuery(upsert.set.checksSyncedAt)

		// The checks rotation reads this cursor to decide which heads still need
		// reconciling. Carrying the previous commit's timestamp onto a new head
		// would present it as already reconciled, so the panel would keep showing
		// the old commit's results until the rotation came back around.
		expect(upsert.set.headSha).toBe('moved-head')
		expect(cursor.sql).toContain('else null end')
		expect(cursor.params).toContain('moved-head')
	})

	test('does not regress a pull request from a provider snapshot older than its mapping', async () => {
		selectLimitMock.mockReturnValue({ for: selectForMock })
		selectForMock.mockResolvedValue([
			{
				pullRequestId,
				repositoryId,
				providerUpdatedAt: new Date('2026-07-11T01:00:00Z'),
			},
		])

		await repository.reconcileGitHubPullRequest({
			repositoryId,
			pullRequest: {
				...gitHubPullRequest,
				title: 'Stale title',
				updatedAt: new Date('2026-07-11T00:30:00Z'),
			},
			authorActorId: gitHubActorId,
			pendingEvents: [],
		})

		expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
		expect(mappingValuesMock).not.toHaveBeenCalled()
	})

	test('edits a pull request and records an edited event', async () => {
		pullRequestUpdateReturningMock.mockResolvedValue([
			{ ...pullRequest, title: 'Updated' },
		])

		expect(
			await repository.edit({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				expectedState: 'open',
				title: 'Updated',
			})
		).toEqual({ ...pullRequest, title: 'Updated' })
		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith({
			title: 'Updated',
			body: undefined,
		})
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'edited',
		})
	})

	test('skips empty edits before opening a transaction', async () => {
		expect(
			await repository.edit({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				expectedState: 'open',
			})
		).toBeUndefined()
		expect(transactionMock).not.toHaveBeenCalled()
	})

	test('returns undefined when edit state no longer matches', async () => {
		pullRequestUpdateReturningMock.mockResolvedValue([])

		expect(
			await repository.edit({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				expectedState: 'open',
				title: 'Updated',
			})
		).toBeUndefined()
		expect(eventValuesMock).not.toHaveBeenCalled()
	})

	test('closes an open pull request and records a closed event', async () => {
		const changedAt = new Date('2026-07-11T00:01:00Z')
		selectLimitMock.mockResolvedValue([])
		const closedPullRequest = {
			...pullRequest,
			state: 'closed' as const,
			closedAt: changedAt,
		}
		pullRequestUpdateReturningMock.mockResolvedValue([closedPullRequest])

		expect(
			await repository.close({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				changedAt,
				staleBefore: new Date('2026-07-11T00:00:00Z'),
			})
		).toEqual(closedPullRequest)
		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith({
			state: 'closed',
			closedAt: changedAt,
		})
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'closed',
		})
	})

	// The entry cannot outlive the pull request it was waiting to merge, so both
	// changes land in one transaction rather than leaving a window where the queue
	// would pick up a closed pull request.
	test('takes the queue entry with the pull request it closes', async () => {
		const changedAt = new Date('2026-07-11T00:01:00Z')
		selectLimitMock.mockResolvedValue([])
		pullRequestUpdateReturningMock.mockResolvedValue([
			{ ...pullRequest, state: 'closed' as const, closedAt: changedAt },
		])
		queueEntryUpdateReturningMock.mockResolvedValue([
			{ id: '00000000-0000-4000-8000-000000000066', position: 4 },
		])

		await repository.close({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			changedAt,
			staleBefore: new Date('2026-07-11T00:00:00Z'),
		})

		expect(queueEntryUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({ state: 'removed', removedByUserId: mockUserId })
		)
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'queue_removed',
			payload: {
				queueEntryId: '00000000-0000-4000-8000-000000000066',
				position: 4,
				reason: 'closed',
			},
		})
	})

	test('does not close while a merge intent lease is active', async () => {
		const changedAt = new Date('2026-07-11T00:01:00Z')
		selectLimitMock.mockResolvedValue([
			{
				attemptId: '00000000-0000-4000-8000-000000000046',
				startedAt: changedAt,
			},
		])

		expect(
			await repository.close({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				changedAt,
				staleBefore: new Date('2026-07-11T00:00:00Z'),
			})
		).toBeUndefined()
		expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
		expect(deleteMock).not.toHaveBeenCalled()
	})

	// Only the target moves. The opening SHAs are the creation facts they always
	// were, and every comparison an open pull request has is resolved from the
	// live branches on the next read.
	describe('retargeting', () => {
		const retargetParams = {
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			expectedTargetBranch: 'main',
			leaseOwner: 'attempt-1',
			targetBranch: 'release',
		}

		beforeEach(() => {
			selectLimitMock.mockResolvedValue([])
		})

		// The lease is re-proved inside the transaction before anything is read: a
		// hold that aged out during recovery may already have been taken by a merge
		// that resolved the branches this would move.
		test('writes nothing once the repository merge lease is gone', async () => {
			selectForMock.mockResolvedValueOnce([])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'lease_lost',
			})
			expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		// The queue-state row is taken before the pull request's, the same order the
		// queue join takes them in. Two orders would be a deadlock.
		test('takes the queue-state row before the pull request row', async () => {
			await repository.retarget(retargetParams)

			const tables = selectFromMock.mock.calls.map(([table]) => table)
			const queueStateIndex = tables.indexOf(repositoryMergeQueueStates)
			const pullRequestIndex = tables.indexOf(pullRequests)

			expect(queueStateIndex).toBeGreaterThanOrEqual(0)
			expect(pullRequestIndex).toBeGreaterThanOrEqual(0)
			expect(queueStateIndex).toBeLessThan(pullRequestIndex)
		})

		test('moves the target and records where it came from', async () => {
			const retargeted = { ...pullRequest, targetBranch: 'release' }
			pullRequestUpdateReturningMock.mockResolvedValue([retargeted])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'retargeted',
				pullRequest: retargeted,
			})
			expect(pullRequestUpdateSetMock).toHaveBeenCalledWith({
				targetBranch: 'release',
			})
			expect(eventValuesMock).toHaveBeenCalledWith({
				pullRequestId,
				actorUserId: mockUserId,
				type: 'retargeted',
				payload: { fromBranch: 'main', toBranch: 'release' },
			})
		})

		test('takes the pull request row for the transaction', async () => {
			await repository.retarget(retargetParams)

			expect(selectForMock).toHaveBeenCalledWith('update')
		})

		test.each([
			'closed',
			'merged',
		] as const)('writes nothing for a %s pull request', async state => {
			selectForMock.mockResolvedValue([{ ...pullRequest, state }])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'pull_request_unavailable',
			})
			expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		// Another retarget committed between the refs being validated and this
		// transaction, and it moved the target somewhere else entirely, so the move
		// this one describes is no longer the move it was asked to make.
		test('writes nothing once the target moved under it', async () => {
			selectForMock.mockResolvedValue([
				{ ...pullRequest, targetBranch: 'develop' },
			])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'pull_request_unavailable',
			})
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		// Two identical requests both read `main`; this is the second one arriving
		// after the first committed. The state it asked for holds, so it is a retry
		// that succeeded rather than a conflict, and it records no second event.
		test('reports a target already moved where it was asked to go as unchanged', async () => {
			const retargeted = { ...pullRequest, targetBranch: 'release' }
			selectForMock.mockResolvedValue([retargeted])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'unchanged',
				pullRequest: retargeted,
			})
			expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		// The service settled what it could under the repository lease and holds it
		// still, so an intent here is a merge in flight or one recovery could not
		// resolve — and both were cleared against the target this would move.
		test('refuses while a merge intent is held', async () => {
			selectLimitMock.mockResolvedValueOnce([
				{
					...mergeRequestColumns,
					attemptId: 'attempt-1',
					startedAt: createdAt,
				},
			])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'merge_in_progress',
			})
			expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		test('refuses while the pull request holds an active queue entry', async () => {
			selectLimitMock
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ state: 'merging' }])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'queued',
				queueState: 'merging',
			})
			expect(pullRequestUpdateSetMock).not.toHaveBeenCalled()
			expect(eventValuesMock).not.toHaveBeenCalled()
		})

		test('records no event when the guarded update matches nothing', async () => {
			pullRequestUpdateReturningMock.mockResolvedValue([])

			expect(await repository.retarget(retargetParams)).toEqual({
				status: 'pull_request_unavailable',
			})
			expect(eventValuesMock).not.toHaveBeenCalled()
		})
	})

	test('reopens a closed pull request and clears the closed timestamp', async () => {
		expect(
			await repository.reopen({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				changedAt: new Date('2026-07-11T00:02:00Z'),
			})
		).toEqual(pullRequest)
		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith({
			state: 'open',
			closedAt: null,
		})
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'reopened',
		})
	})

	test('claims an open pull request merge without external work', async () => {
		const startedAt = new Date('2026-07-11T00:03:00Z')
		selectLimitMock.mockResolvedValue([])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000046',
				request: mergeRequest,
				startedAt,
				staleBefore: new Date('2026-07-11T00:02:00Z'),
			})
		).toMatchObject({ pullRequest, request: mergeRequest })
		expect(mergeIntentValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000046',
			bypass: undefined,
			startedAt,
			...mergeRequestColumns,
		})
	})

	test('does not replace an active merge intent', async () => {
		selectLimitMock.mockResolvedValue([
			{
				attemptId: '00000000-0000-4000-8000-000000000046',
				startedAt: new Date('2026-07-11T00:03:00Z'),
			},
		])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000047',
				request: mergeRequest,
				startedAt: new Date('2026-07-11T00:03:30Z'),
				staleBefore: new Date('2026-07-11T00:02:30Z'),
			})
		).toBeUndefined()
		expect(mergeIntentValuesMock).not.toHaveBeenCalled()
		expect(mergeIntentUpdateSetMock).not.toHaveBeenCalled()
	})

	test('reclaims a stale merge intent lease', async () => {
		const startedAt = new Date('2026-07-11T00:04:00Z')
		selectLimitMock.mockResolvedValue([
			{
				attemptId: '00000000-0000-4000-8000-000000000046',
				bypass: null,
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000047',
				request: mergeRequest,
				startedAt,
				staleBefore: new Date('2026-07-11T00:03:00Z'),
			})
		).toMatchObject({ pullRequest, request: mergeRequest })
		expect(mergeIntentUpdateSetMock).toHaveBeenCalledWith({
			attemptId: '00000000-0000-4000-8000-000000000047',
			actorUserId: mockUserId,
			bypass: undefined,
			startedAt,
			...mergeRequestColumns,
		})
	})

	// Taking over an abandoned attempt must not erase what it was cleared to
	// waive: the merge it was making is still a bypassed merge.
	test('keeps the abandoned attempt bypass when the reclaim carries none', async () => {
		const bypass = {
			reason: 'Production incident',
			bypassedReasonCodes: ['approvals_required' as const],
			baseSha: 'a'.repeat(40),
			headSha: 'b'.repeat(40),
		}
		selectLimitMock.mockResolvedValue([
			{
				attemptId: '00000000-0000-4000-8000-000000000046',
				bypass,
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		await repository.claimMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000047',
			request: mergeRequest,
			startedAt: new Date('2026-07-11T00:04:00Z'),
			staleBefore: new Date('2026-07-11T00:03:00Z'),
		})

		expect(mergeIntentUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({ bypass })
		)
	})

	test('replaces the abandoned attempt bypass when the reclaim brings its own', async () => {
		const bypass = {
			reason: 'Production incident',
			bypassedReasonCodes: ['approvals_required' as const],
			baseSha: 'a'.repeat(40),
			headSha: 'b'.repeat(40),
		}
		selectLimitMock.mockResolvedValue([
			{
				attemptId: '00000000-0000-4000-8000-000000000046',
				bypass,
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		await repository.claimMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000047',
			bypass: { ...bypass, reason: 'Release train' },
			request: mergeRequest,
			startedAt: new Date('2026-07-11T00:04:00Z'),
			staleBefore: new Date('2026-07-11T00:03:00Z'),
		})

		expect(mergeIntentUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				bypass: { ...bypass, reason: 'Release train' },
			})
		)
	})

	// An intent that recorded what it was asking Git for may describe a merge Git
	// already made. Only recovery can find out, so the claim refuses rather than
	// overwriting the evidence — including when the intent aged past the recovery
	// cutoff in the moment between recovery looking and this claim arriving.
	test('refuses to take over an intent that recorded its request', async () => {
		selectLimitMock.mockResolvedValue([
			{
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000046',
				bypass: null,
				strategy: 'squash',
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
				commitMessage: null,
				squashTitle: 'The abandoned title',
				squashBody: '',
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		const claim = await repository.claimMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000047',
			request: mergeRequest,
			startedAt: new Date('2026-07-11T00:04:00Z'),
			staleBefore: new Date('2026-07-11T00:03:00Z'),
		})

		expect(claim).toBeUndefined()
		expect(mergeIntentUpdateSetMock).not.toHaveBeenCalled()
	})

	// An intent written before requests were snapshotted has nothing to replay,
	// so it yields to this attempt's own request.
	test('adopts its own request over an intent that recorded none', async () => {
		selectLimitMock.mockResolvedValue([
			{
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000046',
				bypass: null,
				strategy: 'merge_commit',
				expectedBaseSha: null,
				expectedHeadSha: null,
				commitMessage: null,
				squashTitle: null,
				squashBody: null,
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		const claim = await repository.claimMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000047',
			request: mergeRequest,
			startedAt: new Date('2026-07-11T00:04:00Z'),
			staleBefore: new Date('2026-07-11T00:03:00Z'),
		})

		expect(claim?.request).toEqual(mergeRequest)
	})

	test('completes a claimed merge and records the actor event', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const attemptId = '00000000-0000-4000-8000-000000000046'
		const mergedPullRequest = {
			...pullRequest,
			state: 'merged' as const,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: changedAt,
			closedAt: changedAt,
		}
		pullRequestUpdateReturningMock.mockResolvedValue([mergedPullRequest])
		selectLimitMock.mockResolvedValue([{ attemptId, startedAt: changedAt }])

		expect(
			await repository.completeMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId,
				changedAt,
				resultingSha: 'merge-sha',
			})
		).toEqual(mergedPullRequest)
		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith({
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: changedAt,
			closedAt: changedAt,
		})
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'merged',
		})
		expect(deleteMock).toHaveBeenCalledWith(pullRequestMergeIntents)
	})

	// What was merged is read from the claimed intent rather than from the caller,
	// for the same reason the bypass audit is: the intent is what Git was actually
	// asked for, and it outlives the process that asked.
	test('records the strategy and the tips the intent was claimed with', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const attemptId = '00000000-0000-4000-8000-000000000046'
		pullRequestUpdateReturningMock.mockResolvedValue([
			{ ...pullRequest, state: 'merged' as const },
		])
		selectLimitMock.mockResolvedValue([
			{
				actorUserId: mockUserId,
				attemptId,
				bypass: null,
				strategy: 'rebase',
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
				commitMessage: null,
				squashTitle: null,
				squashBody: null,
				startedAt: changedAt,
			},
		])

		await repository.completeMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId,
			changedAt,
			resultingSha: 'rebased-sha',
		})

		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mergeCommitSha: 'rebased-sha',
				mergeStrategy: 'rebase',
				mergedBaseSha: 'a'.repeat(40),
				mergedHeadSha: 'b'.repeat(40),
			})
		)
		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'merged',
			payload: {
				strategy: 'rebase',
				resultingSha: 'rebased-sha',
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
			},
		})
	})

	// An intent written before requests were snapshotted has no pair to name, so
	// the event stays payload-less exactly as it always was.
	test('leaves the merged event payload-less for a legacy intent', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const attemptId = '00000000-0000-4000-8000-000000000046'
		pullRequestUpdateReturningMock.mockResolvedValue([
			{ ...pullRequest, state: 'merged' as const },
		])
		selectLimitMock.mockResolvedValue([
			{
				actorUserId: mockUserId,
				attemptId,
				bypass: null,
				strategy: 'merge_commit',
				expectedBaseSha: null,
				expectedHeadSha: null,
				commitMessage: null,
				squashTitle: null,
				squashBody: null,
				startedAt: changedAt,
			},
		])

		await repository.completeMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId,
			changedAt,
			resultingSha: 'merge-sha',
		})

		expect(eventValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			type: 'merged',
			payload: undefined,
		})
		expect(pullRequestUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mergedBaseSha: undefined,
				mergedHeadSha: undefined,
			})
		)
	})

	// The merge and the entry that produced it commit together, so the queue can
	// never report an entry still running a merge that already landed.
	test('finishes the queue entry the merge was run for', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const attemptId = '00000000-0000-4000-8000-000000000046'
		const queueEntryId = '00000000-0000-4000-8000-000000000066' as never
		pullRequestUpdateReturningMock.mockResolvedValue([
			{
				...pullRequest,
				state: 'merged' as const,
				mergeCommitSha: 'merge-sha',
				mergeActorUserId: mockUserId,
				mergedAt: changedAt,
				closedAt: changedAt,
			},
		])
		selectLimitMock.mockResolvedValue([{ attemptId, startedAt: changedAt }])
		queueEntryUpdateReturningMock.mockResolvedValueOnce([{ id: queueEntryId }])

		await repository.completeMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId,
			changedAt,
			resultingSha: 'merge-sha',
			queueEntryId,
		})

		expect(queueEntryUpdateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({ state: 'completed' })
		)
	})

	// Something moved the entry while Git was merging. Committing around the hole
	// would record the merge on the pull request while the entry that produced it
	// says it never happened, so the whole transaction is failed instead.
	test('fails the completion when the entry is no longer merging', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const attemptId = '00000000-0000-4000-8000-000000000046'

		pullRequestUpdateReturningMock.mockResolvedValue([
			{
				...pullRequest,
				state: 'merged' as const,
				mergeCommitSha: 'merge-sha',
				mergeActorUserId: mockUserId,
				mergedAt: changedAt,
				closedAt: changedAt,
			},
		])
		selectLimitMock.mockResolvedValue([{ attemptId, startedAt: changedAt }])
		queueEntryUpdateReturningMock.mockResolvedValue([])

		await expect(
			repository.completeMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId,
				changedAt,
				resultingSha: 'merge-sha',
				queueEntryId: '00000000-0000-4000-8000-000000000066' as never,
			})
		).rejects.toThrow(NO_LONGER_MERGING_REGEX)
	})

	test('does not claim a merge when a concurrent close wins the row lock', async () => {
		selectForMock.mockResolvedValue([{ ...pullRequest, state: 'closed' }])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000046',
				request: mergeRequest,
				startedAt: new Date('2026-07-11T00:04:00Z'),
				staleBefore: new Date('2026-07-11T00:03:00Z'),
			})
		).toBeUndefined()
		expect(mergeIntentValuesMock).not.toHaveBeenCalled()
	})

	test('releases only the matching merge attempt', async () => {
		await repository.releaseMerge({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000046',
		})

		expect(deleteMock).toHaveBeenCalledWith(pullRequestMergeIntents)
		expect(deleteWhereMock).toHaveBeenCalledOnce()
	})
})
