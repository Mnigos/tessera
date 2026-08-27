import { GitStorageClient, MERGE_RPC_TIMEOUT_MS } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import {
	MERGE_INTENT_LEASE_MS,
	PullRequestMergeRunner,
	REPOSITORY_MERGE_LEASE_MS,
} from './pull-request-merge.runner'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const queueEntryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const createdAt = new Date('2026-07-11T00:00:00Z')
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
	lastActivityAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const actor = { id: mockUserId, email: 'ada@example.com', name: 'Ada' }
const mergeRequest = {
	strategy: 'merge_commit' as const,
	expectedBaseSha: 'a'.repeat(40),
	expectedHeadSha: 'b'.repeat(40),
	commitMessage: 'Merge pull request #1: Add feature',
}
const runParams = {
	actor,
	leaseOwner: 'attempt-1',
	pullRequest,
	repositoryId,
	request: mergeRequest,
	storagePath: '/var/lib/tessera/repositories/repo.git',
}
const claimedMerge = { actor, pullRequest, request: mergeRequest }

describe(PullRequestMergeRunner.name, () => {
	let moduleRef: TestingModule
	let runner: PullRequestMergeRunner
	let pullRequestsRepository: PullRequestsRepository
	let mergeQueueRepository: MergeQueueRepository
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestMergeRunner,
				{
					provide: PullRequestsRepository,
					useValue: {
						claimMerge: vi.fn(),
						completeMerge: vi.fn(),
						releaseMerge: vi.fn(),
						findById: vi.fn(),
					},
				},
				{
					provide: MergeQueueRepository,
					useValue: { renewRepositoryMergeLease: vi.fn() },
				},
				{
					provide: GitStorageClient,
					useValue: { mergeRepositoryRefs: vi.fn() },
				},
			],
		}).compile()

		runner = moduleRef.get(PullRequestMergeRunner)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(pullRequestsRepository, 'claimMerge').mockResolvedValue(
			claimedMerge
		)
		vi.spyOn(pullRequestsRepository, 'releaseMerge').mockResolvedValue()
		vi.spyOn(pullRequestsRepository, 'completeMerge').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		vi.spyOn(
			mergeQueueRepository,
			'renewRepositoryMergeLease'
		).mockResolvedValue(true)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
			'merge-sha'
		)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	// The entry finishes in the same transaction as the merge, so the queue and
	// the pull request can never disagree about whether it happened.
	test('finishes the queue entry the merge was run for', async () => {
		expect(await runner.run({ ...runParams, queueEntryId })).toMatchObject({
			outcome: 'merged',
		})
		expect(pullRequestsRepository.completeMerge).toHaveBeenCalledWith(
			expect.objectContaining({ queueEntryId, resultingSha: 'merge-sha' })
		)
	})

	test('names no queue entry for a merge nobody queued', async () => {
		await runner.run(runParams)

		expect(pullRequestsRepository.completeMerge).toHaveBeenCalledWith(
			expect.objectContaining({ queueEntryId: undefined })
		)
	})

	// Git is asked to move refs only while this attempt demonstrably still holds
	// the repository, so a lease that aged out stops the merge rather than racing.
	test('abandons the attempt when the repository lease was lost', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'renewRepositoryMergeLease'
		).mockResolvedValue(false)

		expect(await runner.run(runParams)).toEqual({ outcome: 'lease_lost' })
		expect(gitStorageClient.mergeRepositoryRefs).not.toHaveBeenCalled()
		expect(pullRequestsRepository.releaseMerge).toHaveBeenCalledWith(
			expect.objectContaining({ pullRequestId, attemptId: expect.any(String) })
		)
	})

	test.each([
		{
			context: { grpcCode: status.ABORTED },
			kind: { code: 'stale_refs' } as const,
		},
		{
			context: {
				grpcCode: status.FAILED_PRECONDITION,
				grpcDetails: 'repository refs cannot be merged cleanly',
			},
			kind: { code: 'merge_conflict' } as const,
		},
		{
			context: {
				grpcCode: status.FAILED_PRECONDITION,
				grpcDetails:
					'repository merge strategy is unavailable: not_fast_forward',
			},
			kind: {
				code: 'merge_strategy_unavailable',
				strategy: 'merge_commit',
				reason: 'not_fast_forward',
			} as const,
		},
	])('reports Git refusing the swap as $kind.code and hands the claim back', async ({
		context,
		kind,
	}) => {
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', context)
		)

		expect(await runner.run(runParams)).toMatchObject({
			outcome: 'refs_moved',
			kind,
		})
		expect(pullRequestsRepository.releaseMerge).toHaveBeenCalledOnce()
	})

	// The claim decides what Git is asked for. An attempt that took over an
	// abandoned intent is finishing that merge, and git storage recognises its own
	// completed work only by the request that intent recorded.
	test('asks Git for the request the claim handed back, not the one it brought', async () => {
		const persisted = {
			strategy: 'squash' as const,
			expectedBaseSha: 'c'.repeat(40),
			expectedHeadSha: 'd'.repeat(40),
			squashTitle: 'The abandoned title',
			squashBody: 'The abandoned body',
		}
		vi.spyOn(pullRequestsRepository, 'claimMerge').mockResolvedValue({
			pullRequest,
			request: persisted,
		})

		await runner.run(runParams)

		expect(gitStorageClient.mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'squash',
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
				squashTitle: 'The abandoned title',
				squashBody: 'The abandoned body',
				message: '',
			})
		)
	})

	test.each([
		{
			request: {
				strategy: 'rebase' as const,
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
			},
			expected: { strategy: 'rebase', message: '', squashTitle: undefined },
		},
		{
			request: {
				strategy: 'fast_forward' as const,
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
			},
			expected: {
				strategy: 'fast_forward',
				message: '',
				squashTitle: undefined,
			},
		},
	])('carries $request.strategy through to git storage', async ({
		request,
		expected,
	}) => {
		vi.spyOn(pullRequestsRepository, 'claimMerge').mockResolvedValue({
			pullRequest,
			request,
		})

		await runner.run({ ...runParams, request })

		expect(gitStorageClient.mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining(expected)
		)
	})

	// The identifier has to be the same on every attempt, or git storage cannot
	// recognise the operation receipt it filed for the first one.
	test('names the pull request as the operation on every attempt', async () => {
		await runner.run(runParams)

		expect(gitStorageClient.mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: pullRequestId })
		)
	})

	// Somebody else's attempt holds the intent, or the pull request moved on. The
	// caller decides what that means — a person retries, an entry waits.
	test('reports a pull request it could not claim as a state conflict', async () => {
		vi.spyOn(pullRequestsRepository, 'claimMerge').mockResolvedValue(undefined)
		vi.spyOn(pullRequestsRepository, 'findById').mockResolvedValue(pullRequest)

		expect(await runner.run(runParams)).toEqual({
			outcome: 'state_conflict',
			state: 'open',
		})
		expect(gitStorageClient.mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	test('reports a pull request somebody else already merged as merged', async () => {
		vi.spyOn(pullRequestsRepository, 'claimMerge').mockResolvedValue(undefined)
		vi.spyOn(pullRequestsRepository, 'findById').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
		})

		expect(await runner.run(runParams)).toMatchObject({ outcome: 'merged' })
	})
})

/**
 * Git storage's own deadlines, mirrored here because they live in Rust and this
 * is the only place the whole ordering can be stated. `services/git` asserts the
 * same two values against these numbers, so a change on either side fails on
 * both.
 */
const GIT_STORAGE_MERGE_TIMEOUT_MS = 45_000
const GIT_STORAGE_MERGEABILITY_TIMEOUT_MS = 45_000

// Five deadlines, and they have to fire from the inside out. Git storage gives
// up first, so an overrunning merge is refused by the layer that knows what
// happened; the RPC deadline next; the merge intent must outlive both, or a
// concurrent close can delete the record of a merge still in flight; and the
// repository lease outlives everything, so nothing else starts merging the same
// repository while one attempt is still going.
describe('merge timeout ordering', () => {
	test('fires from the inside out', () => {
		const ordering = [
			GIT_STORAGE_MERGE_TIMEOUT_MS,
			MERGE_RPC_TIMEOUT_MS,
			MERGE_INTENT_LEASE_MS,
			REPOSITORY_MERGE_LEASE_MS,
		]

		expect(ordering).toEqual([...ordering].sort((left, right) => left - right))
		expect(new Set(ordering).size).toBe(ordering.length)
	})

	// Mergeability runs under the same lease a merge does and is waited on by the
	// same caller, so it may not outlast the merge deadline either.
	test('bounds the mergeability answer like the merge it clears', () => {
		expect(GIT_STORAGE_MERGEABILITY_TIMEOUT_MS).toBeLessThanOrEqual(
			MERGE_RPC_TIMEOUT_MS
		)
		expect(GIT_STORAGE_MERGEABILITY_TIMEOUT_MS).toBeLessThan(
			MERGE_INTENT_LEASE_MS
		)
	})
})
