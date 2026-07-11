import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	asc,
	pullRequestEvents,
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
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const createdAt = new Date('2026-07-11T00:00:00Z')
const pullRequest = {
	id: pullRequestId,
	repositoryId,
	number: 1,
	authorUserId: mockUserId,
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
}
const event = {
	id: '00000000-0000-4000-8000-000000000045' as PullRequestEventId,
	pullRequestId,
	actorUserId: mockUserId,
	type: 'opened' as const,
	createdAt,
}

describe(PullRequestsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestsRepository

	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const selectFromMock = vi.fn()
	const selectWhereMock = vi.fn()
	const selectOrderByMock = vi.fn()
	const selectLimitMock = vi.fn()
	const selectForMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	const counterValuesMock = vi.fn()
	const counterConflictMock = vi.fn()
	const pullRequestValuesMock = vi.fn()
	const pullRequestReturningMock = vi.fn()
	const eventValuesMock = vi.fn()
	const counterUpdateSetMock = vi.fn()
	const counterUpdateWhereMock = vi.fn()
	const counterUpdateReturningMock = vi.fn()
	const pullRequestUpdateSetMock = vi.fn()
	const pullRequestUpdateWhereMock = vi.fn()
	const pullRequestUpdateReturningMock = vi.fn()

	beforeEach(async () => {
		selectOrderByMock.mockResolvedValue([pullRequest])
		selectLimitMock.mockResolvedValue([pullRequest])
		selectForMock.mockResolvedValue([pullRequest])
		selectWhereMock.mockReturnValue({
			orderBy: selectOrderByMock,
			limit: selectLimitMock,
			for: selectForMock,
		})
		selectFromMock.mockReturnValue({ where: selectWhereMock })
		selectMock.mockReturnValue({ from: selectFromMock })

		counterConflictMock.mockResolvedValue(undefined)
		counterValuesMock.mockReturnValue({
			onConflictDoNothing: counterConflictMock,
		})
		pullRequestReturningMock.mockResolvedValue([pullRequest])
		pullRequestValuesMock.mockReturnValue({
			returning: pullRequestReturningMock,
		})
		eventValuesMock.mockResolvedValue(undefined)
		insertMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { values: counterValuesMock }
			if (table === pullRequests) return { values: pullRequestValuesMock }

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
		updateMock.mockImplementation(table => {
			if (table === repositoryPullRequestCounters)
				return { set: counterUpdateSetMock }

			return { set: pullRequestUpdateSetMock }
		})
		const tx = { insert: insertMock, select: selectMock, update: updateMock }
		transactionMock.mockImplementation(callback => callback(tx))

		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestsRepository,
				{
					provide: Database,
					useValue: {
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
			pullRequest,
		])
		expect(selectOrderByMock).toHaveBeenCalled()
	})

	test('finds a repository-scoped pull request number', async () => {
		expect(await repository.find({ repositoryId, number: 1 })).toEqual(
			pullRequest
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

	test('marks an open pull request merged and records the actor event', async () => {
		const changedAt = new Date('2026-07-11T00:03:00Z')
		const mergedPullRequest = {
			...pullRequest,
			state: 'merged' as const,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: changedAt,
			closedAt: changedAt,
		}
		pullRequestUpdateReturningMock.mockResolvedValue([mergedPullRequest])
		const createMergeCommit = vi.fn().mockResolvedValue('merge-sha')

		expect(
			await repository.merge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				changedAt,
				createMergeCommit,
			})
		).toEqual(mergedPullRequest)
		expect(createMergeCommit).toHaveBeenCalledOnce()
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
	})

	test('does not run Git when a concurrent close wins the row lock', async () => {
		const changedAt = new Date('2026-07-11T00:04:00Z')
		selectForMock.mockResolvedValue([{ ...pullRequest, state: 'closed' }])
		const createMergeCommit = vi.fn().mockResolvedValue('merge-sha')

		expect(
			await repository.merge({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				changedAt,
				createMergeCommit,
			})
		).toBeUndefined()
		expect(createMergeCommit).not.toHaveBeenCalled()
	})
})
