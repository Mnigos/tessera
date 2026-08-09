import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	MergeQueueEntryAlreadyExistsError,
	MergeQueueEntryForbiddenError,
	MergeQueueEntryMergingError,
	MergeQueueEntryNotFoundError,
	MergeQueueEntryNotPausedError,
} from '../domain/merge-queue.errors'
import { PullRequestStateConflictError } from '../domain/pull-request.errors'
import { MergeQueue } from '../infrastructure/merge-queue.queue'
import {
	type MergeQueueEntryReadModel,
	MergeQueueRepository,
} from '../infrastructure/merge-queue.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { MergeQueueService } from './merge-queue.service'
import { MergeQueueStatusService } from './merge-queue-status.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const entryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const otherUserId = '00000000-0000-4000-8000-000000000099' as UserId
const createdAt = new Date('2026-07-11T00:00:00Z')
const input = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}
const repositoryAccessContext = {
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
	viewerRole: 'write' as const,
	tesseraWritesAllowed: true,
}
const pullRequest = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera' as const,
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
const entry: MergeQueueEntryReadModel = {
	id: entryId,
	pullRequestId,
	position: 4,
	state: 'queued',
	blockingReasons: null,
	enqueuedByUserId: mockUserId,
	enqueuedAt: createdAt,
	stateChangedAt: createdAt,
}

describe(MergeQueueService.name, () => {
	let moduleRef: TestingModule
	let service: MergeQueueService
	let mergeQueueRepository: MergeQueueRepository
	let mergeQueue: MergeQueue
	let pullRequestsRepository: PullRequestsRepository
	let repositoriesService: RepositoriesService
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueueService,
				// The real status reader: what these actions report back is the queue
				// as it stands after them, and a stub would assert nothing about that.
				MergeQueueStatusService,
				{
					provide: MergeQueueRepository,
					useValue: {
						enqueueEntry: vi.fn(),
						removeEntry: vi.fn(),
						resumeEntry: vi.fn(),
						findActiveEntry: vi.fn(),
						countRunnableEntries: vi.fn(),
						requestWakeup: vi.fn(),
						listEntriesForInactivePullRequests: vi.fn(),
						listWakeups: vi.fn(),
					},
				},
				{
					provide: MergeQueue,
					useValue: { enqueueWakeup: vi.fn() },
				},
				{
					provide: PullRequestsRepository,
					useValue: { find: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: { getWritableRepositoryContext: vi.fn() },
				},
				{
					provide: GitStorageClient,
					useValue: { checkRepositoryMergeability: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(MergeQueueService)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)
		mergeQueue = moduleRef.get(MergeQueue)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(
			repositoriesService,
			'getWritableRepositoryContext'
		).mockResolvedValue(repositoryAccessContext)
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(0)
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(
			undefined
		)
		vi.spyOn(gitStorageClient, 'checkRepositoryMergeability').mockResolvedValue(
			{
				mergeable: true,
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'c'.repeat(40),
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
			}
		)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	// The entry records what was queued, so the refs come from Git rather than
	// from a caller that may be describing a comparison it read minutes ago.
	test('queues a pull request against the refs it resolves itself', async () => {
		const enqueueSpy = vi
			.spyOn(mergeQueueRepository, 'enqueueEntry')
			.mockResolvedValue({ status: 'enqueued', entry, requestedVersion: 9 })
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(entry)

		expect(await service.join(mockUserId, input)).toMatchObject({
			entry: { entryId, state: 'queued', position: 1 },
		})
		expect(enqueueSpy).toHaveBeenCalledWith({
			repositoryId,
			pullRequestId,
			enqueuedByUserId: mockUserId,
			enqueuedBaseSha: 'a'.repeat(40),
			enqueuedHeadSha: 'b'.repeat(40),
		})
		expect(mergeQueue.enqueueWakeup).toHaveBeenCalledWith({
			repositoryId,
			requestedVersion: 9,
		})
	})

	test('refuses to queue a pull request that already holds an entry', async () => {
		vi.spyOn(mergeQueueRepository, 'enqueueEntry').mockResolvedValue({
			status: 'already_queued',
		})

		await expect(service.join(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryAlreadyExistsError
		)
	})

	test('refuses to queue a pull request that is no longer open', async () => {
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'closed',
		})

		await expect(service.join(mockUserId, input)).rejects.toBeInstanceOf(
			PullRequestStateConflictError
		)
	})

	// The pull request was open when the join started and the enqueue found it
	// closed under the lock, which is the close committing while Git was being
	// asked about the refs. The caller is told what it would have been told a
	// moment later, and no entry and no event survive the race.
	test('refuses a join the pull request closed underneath', async () => {
		vi.spyOn(mergeQueueRepository, 'enqueueEntry').mockResolvedValue({
			status: 'pull_request_unavailable',
		})
		vi.spyOn(pullRequestsRepository, 'find')
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValue({ ...pullRequest, state: 'closed' })

		await expect(service.join(mockUserId, input)).rejects.toBeInstanceOf(
			PullRequestStateConflictError
		)
		expect(mergeQueue.enqueueWakeup).not.toHaveBeenCalled()
	})

	test('lets the user who queued a pull request take it back out', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(entry)
		const removeSpy = vi
			.spyOn(mergeQueueRepository, 'removeEntry')
			.mockResolvedValue({
				entry: { ...entry, state: 'removed' },
				requestedVersion: 4,
			})

		await service.leave(mockUserId, input)

		expect(removeSpy).toHaveBeenCalledWith({
			repositoryId,
			pullRequestId,
			actorUserId: mockUserId,
			reason: 'user',
		})
	})

	// Git has been handed the branch by the time an entry is merging. Letting it
	// be withdrawn from under that would leave a pull request that merged beside
	// a queue entry that says it was removed.
	test('refuses to take an entry out while it is being merged', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			...entry,
			state: 'merging',
		})
		const removeSpy = vi.spyOn(mergeQueueRepository, 'removeEntry')

		await expect(service.leave(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryMergingError
		)
		expect(removeSpy).not.toHaveBeenCalled()
	})

	// The entry started merging between being read and being removed, so the
	// removal came back empty. Reading the state again is what tells that race
	// apart from an entry somebody else took out in the same moment.
	test('refuses a removal the merge won the race for', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry')
			.mockResolvedValueOnce(entry)
			.mockResolvedValue({ ...entry, state: 'merging' })
		vi.spyOn(mergeQueueRepository, 'removeEntry').mockResolvedValue(undefined)

		await expect(service.leave(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryMergingError
		)
	})

	test('reports an entry that left the queue before the removal landed', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry')
			.mockResolvedValueOnce(entry)
			.mockResolvedValue(undefined)
		vi.spyOn(mergeQueueRepository, 'removeEntry').mockResolvedValue(undefined)

		await expect(service.leave(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryNotFoundError
		)
	})

	// A queue only its author can unblock is one a mistake can hold hostage, and
	// the audit records which of the two it was.
	test('lets an administrator remove somebody else’s entry', async () => {
		vi.spyOn(
			repositoriesService,
			'getWritableRepositoryContext'
		).mockResolvedValue({ ...repositoryAccessContext, viewerRole: 'admin' })
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			...entry,
			enqueuedByUserId: otherUserId,
		})
		const removeSpy = vi
			.spyOn(mergeQueueRepository, 'removeEntry')
			.mockResolvedValue({
				entry: { ...entry, state: 'removed' },
				requestedVersion: 4,
			})

		await service.leave(mockUserId, input)

		expect(removeSpy).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'admin' })
		)
	})

	test('refuses to let a writer remove somebody else’s entry', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			...entry,
			enqueuedByUserId: otherUserId,
		})
		const removeSpy = vi.spyOn(mergeQueueRepository, 'removeEntry')

		await expect(service.leave(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryForbiddenError
		)
		expect(removeSpy).not.toHaveBeenCalled()
	})

	test('reports leaving a queue the pull request is not in', async () => {
		await expect(service.leave(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryNotFoundError
		)
	})

	test('sends a paused entry back to the queue and wakes the worker', async () => {
		vi.spyOn(mergeQueueRepository, 'resumeEntry').mockResolvedValue({
			entry: { ...entry, position: 12 },
			requestedVersion: 21,
		})

		await service.retry(mockUserId, input)

		expect(mergeQueue.enqueueWakeup).toHaveBeenCalledWith({
			repositoryId,
			requestedVersion: 21,
		})
	})

	test('refuses to retry an entry that is not paused', async () => {
		vi.spyOn(mergeQueueRepository, 'resumeEntry').mockResolvedValue(undefined)

		await expect(service.retry(mockUserId, input)).rejects.toBeInstanceOf(
			MergeQueueEntryNotPausedError
		)
	})

	// The change is already committed by the time Redis is asked, so a queue that
	// will not take the job must not turn a queue join into a failed request.
	test('reports the queue change even when the wakeup cannot be sent', async () => {
		vi.spyOn(mergeQueueRepository, 'enqueueEntry').mockResolvedValue({
			status: 'enqueued',
			entry,
			requestedVersion: 9,
		})
		vi.spyOn(mergeQueue, 'enqueueWakeup').mockRejectedValue(
			new Error('Redis unavailable')
		)
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(entry)

		await expect(service.join(mockUserId, input)).resolves.toMatchObject({
			entry: { entryId },
		})
	})

	test('removes queued entries whose pull request stopped being open', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'listEntriesForInactivePullRequests'
		).mockResolvedValue([
			{ entryId, pullRequestId, pullRequestState: 'merged', repositoryId },
		])
		vi.spyOn(mergeQueueRepository, 'listWakeups').mockResolvedValue([])
		const removeSpy = vi
			.spyOn(mergeQueueRepository, 'removeEntry')
			.mockResolvedValue({
				entry: { ...entry, state: 'removed' },
				requestedVersion: 2,
			})

		await service.reconcile(25)

		expect(removeSpy).toHaveBeenCalledWith({
			repositoryId,
			pullRequestId,
			reason: 'merged',
		})
	})

	test('re-sends the wakeups the queue is still owed', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'listEntriesForInactivePullRequests'
		).mockResolvedValue([])
		vi.spyOn(mergeQueueRepository, 'listWakeups').mockResolvedValue([
			{ repositoryId, requestedVersion: 5 },
		])

		await service.reconcile(25)

		expect(mergeQueue.enqueueWakeup).toHaveBeenCalledWith({
			repositoryId,
			requestedVersion: 5,
		})
	})
})
