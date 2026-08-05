import { Database } from '@config/database'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubActorId } from '@repo/db'
import {
	asc,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositoryPullRequestCounters,
} from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestsRepository } from './pull-requests.repository'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const anotherRepositoryId =
	'00000000-0000-4000-8000-000000000003' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const gitHubActorId = '00000000-0000-4000-8000-000000000055' as GitHubActorId
const createdAt = new Date('2026-07-11T00:00:00Z')
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
	const counterUpdateSetMock = vi.fn()
	const counterUpdateWhereMock = vi.fn()
	const counterUpdateReturningMock = vi.fn()
	const pullRequestUpdateSetMock = vi.fn()
	const pullRequestUpdateWhereMock = vi.fn()
	const pullRequestUpdateReturningMock = vi.fn()
	const mergeIntentUpdateSetMock = vi.fn()
	const mergeIntentUpdateWhereMock = vi.fn()
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
		insertMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { values: counterValuesMock }
			if (table === pullRequests) return { values: pullRequestValuesMock }
			if (table === pullRequestMergeIntents)
				return { values: mergeIntentValuesMock }

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
		updateMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { set: counterUpdateSetMock }
			if (table === pullRequestMergeIntents)
				return { set: mergeIntentUpdateSetMock }

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

	test('returns lifecycle events in ascending creation order', async () => {
		selectOrderByMock.mockResolvedValue([event])

		expect(await repository.listEvents({ pullRequestId })).toEqual([event])
		expect(selectOrderByMock).toHaveBeenCalledWith(
			asc(pullRequestEvents.createdAt)
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
				startedAt,
				staleBefore: new Date('2026-07-11T00:02:00Z'),
			})
		).toEqual(pullRequest)
		expect(mergeIntentValuesMock).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			attemptId: '00000000-0000-4000-8000-000000000046',
			startedAt,
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
				startedAt: new Date('2026-07-11T00:02:00Z'),
			},
		])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000047',
				startedAt,
				staleBefore: new Date('2026-07-11T00:03:00Z'),
			})
		).toEqual(pullRequest)
		expect(mergeIntentUpdateSetMock).toHaveBeenCalledWith({
			attemptId: '00000000-0000-4000-8000-000000000047',
			actorUserId: mockUserId,
			startedAt,
		})
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
				mergeCommitSha: 'merge-sha',
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

	test('does not claim a merge when a concurrent close wins the row lock', async () => {
		selectForMock.mockResolvedValue([{ ...pullRequest, state: 'closed' }])

		expect(
			await repository.claimMerge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				attemptId: '00000000-0000-4000-8000-000000000046',
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
