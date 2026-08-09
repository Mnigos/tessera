import { GitStorageClient } from '@config/git-storage'
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
import { PullRequestMergeRunner } from './pull-request-merge.runner'

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
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const runParams = {
	actor: { id: mockUserId, email: 'ada@example.com', name: 'Ada' },
	evaluatedBaseSha: 'a'.repeat(40),
	evaluatedHeadSha: 'b'.repeat(40),
	leaseOwner: 'attempt-1',
	pullRequest,
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
}

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
			pullRequest
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
			expect.objectContaining({ queueEntryId, mergeCommitSha: 'merge-sha' })
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
		{ context: { grpcCode: status.ABORTED }, kind: 'stale_refs' as const },
		{
			context: {
				grpcCode: status.FAILED_PRECONDITION,
				grpcDetails: 'repository refs cannot be merged cleanly',
			},
			kind: 'merge_conflict' as const,
		},
	])('reports Git refusing the swap as $kind and hands the claim back', async ({
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
