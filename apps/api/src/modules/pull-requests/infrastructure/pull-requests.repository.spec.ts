import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	pullRequestEvents,
	pullRequests,
	repositoryPullRequestCounters,
} from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'
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

describe(PullRequestsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: PullRequestsRepository

	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const selectFromMock = vi.fn()
	const selectWhereMock = vi.fn()
	const selectOrderByMock = vi.fn()
	const selectLimitMock = vi.fn()
	const insertMock = vi.fn()
	const updateMock = vi.fn()
	const counterValuesMock = vi.fn()
	const counterConflictMock = vi.fn()
	const pullRequestValuesMock = vi.fn()
	const pullRequestReturningMock = vi.fn()
	const eventValuesMock = vi.fn()
	const updateSetMock = vi.fn()
	const updateWhereMock = vi.fn()
	const updateReturningMock = vi.fn()

	beforeEach(async () => {
		selectOrderByMock.mockResolvedValue([pullRequest])
		selectLimitMock.mockResolvedValue([pullRequest])
		selectWhereMock.mockReturnValue({
			orderBy: selectOrderByMock,
			limit: selectLimitMock,
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

		updateReturningMock.mockResolvedValue([{ nextNumber: 2 }])
		updateWhereMock.mockReturnValue({ returning: updateReturningMock })
		updateSetMock.mockReturnValue({ where: updateWhereMock })
		updateMock.mockReturnValue({ set: updateSetMock })
		const tx = { insert: insertMock, update: updateMock }
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
		updateReturningMock.mockResolvedValue([])

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
})
