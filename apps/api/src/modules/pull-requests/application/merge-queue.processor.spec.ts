import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { MergeRequirements } from '@repo/contracts'
import type {
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import type { Job } from 'bullmq'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestStaleComparisonError } from '../domain/pull-request.errors'
import {
	MERGE_QUEUE_RECONCILER_JOB,
	MERGE_QUEUE_WAKEUP_JOB,
	MergeQueue,
	type MergeQueueJobData,
} from '../infrastructure/merge-queue.queue'
import {
	MergeQueueRepository,
	type MergeQueueRunnableEntry,
} from '../infrastructure/merge-queue.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { MergeQueueProcessor } from './merge-queue.processor'
import { MergeQueueService } from './merge-queue.service'
import { MergeRequirementsService } from './merge-requirements.service'
import { PullRequestMergeRunner } from './pull-request-merge.runner'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const entryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const createdAt = new Date('2026-07-11T00:00:00Z')
const mergeContext = {
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
	tesseraWritesAllowed: true,
	viewerRole: 'write' as const,
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
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const entry: MergeQueueRunnableEntry = {
	id: entryId,
	pullRequestId,
	position: 3,
	state: 'queued',
	strategy: 'merge_commit',
	squashTitle: null,
	squashBody: null,
	blockingReasons: null,
	enqueuedByUserId: mockUserId,
	enqueuedAt: createdAt,
	stateChangedAt: createdAt,
	enqueuedBy: { id: mockUserId, email: 'ada@example.com', name: 'Ada' },
}
const eligibleRequirements: MergeRequirements = {
	eligible: true,
	evaluatedBaseSha: 'a'.repeat(40),
	evaluatedHeadSha: 'b'.repeat(40),
	canBypass: false,
	reasons: [],
}
const blockedRequirements: MergeRequirements = {
	...eligibleRequirements,
	eligible: false,
	reasons: [{ code: 'threads_unresolved', count: 2 }],
}

function wakeupJob() {
	return {
		name: MERGE_QUEUE_WAKEUP_JOB,
		data: { repositoryId, requestedVersion: 4 },
	} as Job<MergeQueueJobData>
}

describe(MergeQueueProcessor.name, () => {
	let moduleRef: TestingModule
	let processor: MergeQueueProcessor
	let mergeQueue: MergeQueue
	let mergeQueueRepository: MergeQueueRepository
	let mergeQueueService: MergeQueueService
	let mergeRequirementsService: MergeRequirementsService
	let pullRequestMergeRunner: PullRequestMergeRunner
	let pullRequestsRepository: PullRequestsRepository
	let gitStorageClient: GitStorageClient
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueueProcessor,
				{
					provide: EnvService,
					useValue: { get: vi.fn(() => 25) },
				},
				{
					provide: MergeQueue,
					useValue: { enqueueWakeup: vi.fn() },
				},
				{
					provide: MergeQueueRepository,
					useValue: {
						acquireRepositoryMergeLease: vi.fn(),
						releaseRepositoryMergeLease: vi.fn(),
						resetOrphanedEntries: vi.fn(),
						findNextRunnableEntry: vi.fn(),
						startValidatingEntry: vi.fn(),
						startMergingEntry: vi.fn(),
						pauseEntry: vi.fn(),
						removeEntry: vi.fn(),
						completeWakeup: vi.fn(),
					},
				},
				{
					provide: MergeQueueService,
					useValue: { reconcile: vi.fn() },
				},
				{
					provide: MergeRequirementsService,
					useValue: { evaluate: vi.fn() },
				},
				{
					provide: PullRequestMergeRunner,
					useValue: { run: vi.fn() },
				},
				{
					provide: PullRequestsRepository,
					useValue: {
						findById: vi.fn(),
						findRecoverableMergeIntent: vi.fn(),
						releaseMerge: vi.fn(),
						completeMerge: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: { findMergeReceipt: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: { findRepositoryMergeContext: vi.fn() },
				},
			],
		}).compile()

		processor = moduleRef.get(MergeQueueProcessor)
		mergeQueue = moduleRef.get(MergeQueue)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)
		mergeQueueService = moduleRef.get(MergeQueueService)
		mergeRequirementsService = moduleRef.get(MergeRequirementsService)
		pullRequestMergeRunner = moduleRef.get(PullRequestMergeRunner)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)
		repositoriesService = moduleRef.get(RepositoriesService)

		vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		).mockResolvedValue(true)
		vi.spyOn(
			mergeQueueRepository,
			'releaseRepositoryMergeLease'
		).mockResolvedValue()
		vi.spyOn(mergeQueueRepository, 'resetOrphanedEntries').mockResolvedValue(0)
		vi.spyOn(mergeQueueRepository, 'startValidatingEntry').mockResolvedValue(
			true
		)
		vi.spyOn(mergeQueueRepository, 'startMergingEntry').mockResolvedValue(true)
		vi.spyOn(mergeQueueRepository, 'pauseEntry').mockResolvedValue(true)
		vi.spyOn(mergeQueueRepository, 'completeWakeup').mockResolvedValue(
			undefined
		)
		vi.spyOn(mergeQueueRepository, 'findNextRunnableEntry')
			.mockResolvedValueOnce(entry)
			.mockResolvedValue(undefined)
		vi.spyOn(
			repositoriesService,
			'findRepositoryMergeContext'
		).mockResolvedValue(mergeContext)
		vi.spyOn(pullRequestsRepository, 'findById').mockResolvedValue(pullRequest)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			eligibleRequirements
		)
		vi.spyOn(pullRequestMergeRunner, 'run').mockResolvedValue({
			outcome: 'merged',
			pullRequest: { ...pullRequest, state: 'merged' },
		})
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('reconciles the queue from the database on the scheduled pass', async () => {
		await processor.process({
			name: MERGE_QUEUE_RECONCILER_JOB,
			data: { type: 'reconciler' },
		} as Job<MergeQueueJobData>)

		expect(mergeQueueService.reconcile).toHaveBeenCalledWith(25)
		expect(
			mergeQueueRepository.acquireRepositoryMergeLease
		).not.toHaveBeenCalled()
	})

	// Somebody else is merging this repository, and whoever holds the lease will
	// drain what it can. Two runs on one repository is exactly what the lease is
	// there to prevent.
	test('does nothing with a repository it cannot take the lease on', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		).mockResolvedValue(false)

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.findNextRunnableEntry).not.toHaveBeenCalled()
		expect(
			mergeQueueRepository.releaseRepositoryMergeLease
		).not.toHaveBeenCalled()
	})

	test('merges the entry at the front and moves on to the next', async () => {
		await processor.process(wakeupJob())

		expect(mergeQueueRepository.startValidatingEntry).toHaveBeenCalledWith({
			entryId,
			leaseOwner: expect.any(String),
		})
		expect(mergeQueueRepository.startMergingEntry).toHaveBeenCalledWith({
			entryId,
			leaseOwner: expect.any(String),
		})
		expect(pullRequestMergeRunner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				queueEntryId: entryId,
				request: {
					strategy: 'merge_commit',
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
					commitMessage: 'Merge pull request #1: Add feature',
				},
				actor: { id: mockUserId, email: 'ada@example.com', name: 'Ada' },
			})
		)
		// Two calls: the entry it merged, and the look that found nothing behind it.
		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledTimes(2)
		expect(
			mergeQueueRepository.releaseRepositoryMergeLease
		).toHaveBeenCalledOnce()
	})

	// The entry's method travels from the row to the merge unchanged, squash
	// overrides included: nothing between the queue and Git may re-choose it.
	test('merges the entry by the method it was queued with', async () => {
		vi.spyOn(mergeQueueRepository, 'findNextRunnableEntry')
			.mockResolvedValueOnce({
				...entry,
				strategy: 'squash',
				squashTitle: 'Queued title',
				squashBody: 'Queued body',
			})
			.mockResolvedValue(undefined)

		await processor.process(wakeupJob())

		expect(mergeRequirementsService.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'squash' })
		)
		expect(pullRequestMergeRunner.run).toHaveBeenCalledWith(
			expect.objectContaining({
				request: {
					strategy: 'squash',
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
					squashTitle: 'Queued title',
					squashBody: 'Queued body',
				},
			})
		)
	})

	// An earlier attempt may have reached Git and died before recording it,
	// leaving the target somewhere a fresh evaluation reads as stale. The receipt
	// is what says whether that merge actually happened.
	describe('recovering an abandoned merge', () => {
		const abandoned = {
			actor: { id: mockUserId, name: 'Grace', email: 'grace@example.com' },
			attemptId: '00000000-0000-4000-8000-000000000099',
			request: {
				strategy: 'rebase' as const,
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
			},
			startedAt: new Date('2026-07-11T00:00:00Z'),
		}

		beforeEach(() => {
			vi.spyOn(
				pullRequestsRepository,
				'findRecoverableMergeIntent'
			).mockResolvedValue(abandoned)
			vi.spyOn(pullRequestsRepository, 'releaseMerge').mockResolvedValue()
			vi.spyOn(pullRequestsRepository, 'completeMerge').mockResolvedValue({
				...pullRequest,
				state: 'merged',
			})
		})

		test('records a merge git storage had already made and moves on', async () => {
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
				'merge-sha'
			)

			await processor.process(wakeupJob())

			expect(pullRequestsRepository.completeMerge).toHaveBeenCalledWith(
				expect.objectContaining({
					attemptId: abandoned.attemptId,
					actorUserId: abandoned.actor.id,
					resultingSha: 'merge-sha',
				})
			)
			// The abandoned attempt may have been a direct merge rather than this
			// entry's, so the entry is not named as the one that made it — the
			// completion drops it as merged like any other leftover.
			expect(pullRequestsRepository.completeMerge).toHaveBeenCalledWith(
				expect.not.objectContaining({ queueEntryId: entryId })
			)
			expect(mergeRequirementsService.evaluate).not.toHaveBeenCalled()
			expect(pullRequestMergeRunner.run).not.toHaveBeenCalled()
		})

		// Running it would merge unattended on the strength of an evaluation
		// nobody repeated, under an actor and a waiver it inherited.
		test('never merges an intent git storage has no receipt for', async () => {
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
				undefined
			)

			await processor.process(wakeupJob())

			expect(pullRequestsRepository.releaseMerge).toHaveBeenCalledWith(
				expect.objectContaining({ attemptId: abandoned.attemptId })
			)
			expect(pullRequestsRepository.completeMerge).not.toHaveBeenCalled()
			// The entry is judged on its own merits instead.
			expect(mergeRequirementsService.evaluate).toHaveBeenCalled()
		})

		test('leaves a mirrored repository alone', async () => {
			vi.spyOn(
				repositoriesService,
				'findRepositoryMergeContext'
			).mockResolvedValue({
				...mergeContext,
				tesseraWritesAllowed: false,
			})
			const findReceipt = vi.spyOn(gitStorageClient, 'findMergeReceipt')

			await processor.process(wakeupJob())

			expect(findReceipt).not.toHaveBeenCalled()
			expect(pullRequestsRepository.completeMerge).not.toHaveBeenCalled()
		})
	})

	// Being queued is why the evaluation is happening, so the entry's own presence
	// must not come back as a reason to refuse it.
	test('evaluates on behalf of the entry it is running', async () => {
		await processor.process(wakeupJob())

		expect(mergeRequirementsService.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				queueEntryId: entryId,
				leaseOwner: expect.any(String),
				viewerRole: 'write',
				tesseraWritesAllowed: true,
			})
		)
	})

	test('returns entries a dead run left mid-flight to the queue first', async () => {
		vi.spyOn(mergeQueueRepository, 'resetOrphanedEntries').mockResolvedValue(2)

		await processor.process(wakeupJob())

		const [resetOrder = 0] = vi.mocked(
			mergeQueueRepository.resetOrphanedEntries
		).mock.invocationCallOrder
		const [findOrder = 0] = vi.mocked(
			mergeQueueRepository.findNextRunnableEntry
		).mock.invocationCallOrder

		expect(resetOrder).toBeLessThan(findOrder)
	})

	// A paused entry is retained and skipped rather than blocking, so one pull
	// request nobody can fix cannot stop the repository from merging anything else.
	test('pauses a blocked entry with its reasons and carries on', async () => {
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.pauseEntry).toHaveBeenCalledWith({
			entryId,
			leaseOwner: expect.any(String),
			pullRequestId,
			blockingReasons: [{ code: 'threads_unresolved', count: 2 }],
			evaluatedBaseSha: 'a'.repeat(40),
			evaluatedHeadSha: 'b'.repeat(40),
		})
		expect(pullRequestMergeRunner.run).not.toHaveBeenCalled()
		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledTimes(2)
	})

	test('takes an entry out of the queue once its pull request closed', async () => {
		vi.spyOn(pullRequestsRepository, 'findById').mockResolvedValue({
			...pullRequest,
			state: 'closed',
		})
		vi.spyOn(mergeQueueRepository, 'removeEntry').mockResolvedValue(undefined)

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.removeEntry).toHaveBeenCalledWith({
			repositoryId,
			pullRequestId,
			reason: 'closed',
		})
		expect(mergeQueueRepository.startValidatingEntry).not.toHaveBeenCalled()
	})

	// The state transition is the guard: a second delivery of the same wakeup finds
	// the entry already moved and does not run it twice.
	test('stops when the entry it picked was already taken', async () => {
		vi.spyOn(mergeQueueRepository, 'startValidatingEntry').mockResolvedValue(
			false
		)

		await processor.process(wakeupJob())

		expect(mergeRequirementsService.evaluate).not.toHaveBeenCalled()
		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledOnce()
	})

	test('stops touching a repository whose lease it lost mid-merge', async () => {
		vi.spyOn(pullRequestMergeRunner, 'run').mockResolvedValue({
			outcome: 'lease_lost',
		})

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.pauseEntry).not.toHaveBeenCalled()
		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledOnce()
	})

	// The evaluation ran under this run's own lease, so this is the hold ageing
	// out mid-evaluation. The entry may have been returned to the queue and picked
	// up by the next holder since, and parking it here would park theirs.
	test('leaves the entry alone when the evaluation says the lease is gone', async () => {
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue({
			...eligibleRequirements,
			eligible: false,
			reasons: [{ code: 'repository_merge_in_progress' }],
		})

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.pauseEntry).not.toHaveBeenCalled()
		expect(mergeQueueRepository.startMergingEntry).not.toHaveBeenCalled()
		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledOnce()
	})

	// The pause is fenced on the lease in the database too, so a run that lost the
	// repository between evaluating and writing is refused there rather than
	// carrying on down a queue it no longer serves.
	test('stops draining when the database refuses its pause', async () => {
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)
		vi.spyOn(mergeQueueRepository, 'pauseEntry').mockResolvedValue(false)

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.findNextRunnableEntry).toHaveBeenCalledOnce()
	})

	// Every transition the worker makes carries the lease it believes it holds, so
	// the database can refuse a run that has already lost its turn.
	test('fences every entry transition on the lease it took', async () => {
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)

		await processor.process(wakeupJob())

		const [validating] = vi.mocked(mergeQueueRepository.startValidatingEntry)
			.mock.calls
		const [paused] = vi.mocked(mergeQueueRepository.pauseEntry).mock.calls

		expect(validating?.[0].leaseOwner).toBe(paused?.[0].leaseOwner)
		expect(validating?.[0].leaseOwner).toEqual(expect.any(String))
	})

	// Git had the last word on freshness, so the entry is parked with what a fresh
	// evaluation says the refs are now rather than with the pair it tried.
	test('pauses with freshly resolved refs when Git rejected the swap', async () => {
		vi.spyOn(pullRequestMergeRunner, 'run').mockResolvedValue({
			outcome: 'refs_moved',
			error: new PullRequestStaleComparisonError(),
			kind: { code: 'stale_refs' },
		})
		vi.spyOn(mergeRequirementsService, 'evaluate')
			.mockResolvedValueOnce(eligibleRequirements)
			.mockResolvedValueOnce({
				...eligibleRequirements,
				eligible: false,
				evaluatedBaseSha: 'c'.repeat(40),
				evaluatedHeadSha: 'd'.repeat(40),
				reasons: [
					{
						code: 'stale_refs',
						expectedBaseSha: 'a'.repeat(40),
						actualBaseSha: 'c'.repeat(40),
						expectedHeadSha: 'b'.repeat(40),
						actualHeadSha: 'd'.repeat(40),
					},
				],
			})

		await processor.process(wakeupJob())

		expect(mergeQueueRepository.pauseEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				blockingReasons: [
					{
						code: 'stale_refs',
						expectedBaseSha: 'a'.repeat(40),
						actualBaseSha: 'c'.repeat(40),
						expectedHeadSha: 'b'.repeat(40),
						actualHeadSha: 'd'.repeat(40),
					},
				],
			})
		)
	})

	test('chains the follow-up wakeup the queue asked for while it ran', async () => {
		vi.spyOn(mergeQueueRepository, 'completeWakeup').mockResolvedValue(9)

		await processor.process(wakeupJob())

		expect(mergeQueue.enqueueWakeup).toHaveBeenCalledWith({
			repositoryId,
			requestedVersion: 9,
		})
	})

	test('sends no follow-up when nothing changed while it ran', async () => {
		await processor.process(wakeupJob())

		expect(mergeQueueRepository.completeWakeup).toHaveBeenCalledWith({
			repositoryId,
			requestedVersion: 4,
		})
		expect(mergeQueue.enqueueWakeup).not.toHaveBeenCalled()
	})

	test('gives the lease back even when running an entry throws', async () => {
		vi.spyOn(pullRequestMergeRunner, 'run').mockRejectedValue(
			new Error('git storage unavailable')
		)

		await expect(processor.process(wakeupJob())).rejects.toThrow(
			'git storage unavailable'
		)
		expect(
			mergeQueueRepository.releaseRepositoryMergeLease
		).toHaveBeenCalledOnce()
	})
})
