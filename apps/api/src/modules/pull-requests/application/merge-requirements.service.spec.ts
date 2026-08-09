import { GitStorageClient } from '@config/git-storage'
import {
	type BranchProtectionRuleView,
	BranchProtectionService,
} from '@modules/branch-protection'
import { ChecksEvaluationService } from '@modules/checks'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	BranchProtectionRuleId,
	MergeQueueEntryId,
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import type { PullRequestReviewReadModel } from '../infrastructure/pull-request-reviews.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import { PullRequestThreadsRepository } from '../infrastructure/pull-request-threads.repository'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'
import { MergeRequirementsService } from './merge-requirements.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const ruleId = '00000000-0000-4000-8000-000000000055' as BranchProtectionRuleId
const entryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const reviewerUserId = '00000000-0000-4000-8000-000000000077' as UserId
const createdAt = new Date('2026-07-11T00:00:00Z')
const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const storagePath = '/var/lib/tessera/repositories/repo.git'

const pullRequest: PullRequestReadModel = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: baseSha,
	openingHeadSha: headSha,
	title: 'Add feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}

const rule: BranchProtectionRuleView = {
	id: ruleId,
	targetBranch: 'main',
	requiredApprovals: 0,
	requiredCheckContexts: [],
	requireThreadsResolved: false,
	dismissStaleApprovals: true,
	bypassMinimumRole: null,
	version: 3,
	createdAt,
	updatedAt: createdAt,
}

function gitHubPullRequest(
	github: Partial<NonNullable<PullRequestReadModel['github']>> = {}
): PullRequestReadModel {
	return {
		...pullRequest,
		github: {
			nodeId: 'PR_kwDOExample',
			htmlUrl: 'https://github.com/marta/notes/pull/1',
			draft: false,
			headSha,
			baseSha,
			...github,
		},
	}
}

function review(
	overrides: Partial<PullRequestReviewReadModel> & {
		outcome: 'approve' | 'request_changes'
	}
): PullRequestReviewReadModel {
	return {
		id: '00000000-0000-4000-8000-000000000088' as PullRequestReviewId,
		reviewer: {
			userId: reviewerUserId,
			username: 'ada',
			externalNodeId: null,
			externalLogin: null,
			externalAvatarUrl: null,
			externalHtmlUrl: null,
		},
		state: 'submitted',
		body: '',
		headSha,
		submittedAt: createdAt,
		dismissedAt: null,
		dismissedBy: {
			userId: null,
			username: null,
			externalNodeId: null,
			externalLogin: null,
			externalAvatarUrl: null,
			externalHtmlUrl: null,
		},
		sourceUrl: null,
		...overrides,
	}
}

describe(MergeRequirementsService.name, () => {
	let moduleRef: TestingModule
	let service: MergeRequirementsService
	let branchProtectionService: BranchProtectionService
	let checksEvaluationService: ChecksEvaluationService
	let mergeQueueRepository: MergeQueueRepository
	let reviewsRepository: PullRequestReviewsRepository
	let threadsRepository: PullRequestThreadsRepository
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeRequirementsService,
				{
					provide: BranchProtectionService,
					useValue: { findRuleForBranch: vi.fn() },
				},
				{
					provide: ChecksEvaluationService,
					useValue: { evaluate: vi.fn() },
				},
				{
					provide: MergeQueueRepository,
					useValue: {
						findActiveEntry: vi.fn(),
						countRunnableEntries: vi.fn(),
						findRepositoryMergeLeaseOwner: vi.fn(),
					},
				},
				{
					provide: PullRequestReviewsRepository,
					useValue: { listReviewHistory: vi.fn() },
				},
				{
					provide: PullRequestThreadsRepository,
					useValue: { countUnresolvedThreads: vi.fn() },
				},
				{
					provide: GitStorageClient,
					useValue: { checkRepositoryMergeability: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(MergeRequirementsService)
		branchProtectionService = moduleRef.get(BranchProtectionService)
		checksEvaluationService = moduleRef.get(ChecksEvaluationService)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		threadsRepository = moduleRef.get(PullRequestThreadsRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue(
			undefined
		)
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([])
		vi.spyOn(threadsRepository, 'countUnresolvedThreads').mockResolvedValue(0)
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(
			undefined
		)
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(0)
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue(undefined)
		vi.spyOn(gitStorageClient, 'checkRepositoryMergeability').mockResolvedValue(
			{
				baseSha,
				headSha,
				mergeBaseSha: baseSha,
				mergeable: true,
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: [
					{ strategy: 'merge_commit', available: true },
					{ strategy: 'squash', available: true },
					{ strategy: 'rebase', available: true },
					{ strategy: 'fast_forward', available: true },
				],
			}
		)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	function evaluate(
		overrides: Partial<Parameters<MergeRequirementsService['evaluate']>[0]> = {}
	) {
		return service.evaluate({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed: true,
			viewerRole: 'write',
			...overrides,
		})
	}

	// Every strategy is reported so the client can offer all four, and only the
	// one the caller means to use is allowed to refuse the merge.
	describe('per-strategy availability', () => {
		const strategyAvailability = [
			{ strategy: 'merge_commit' as const, available: true },
			{ strategy: 'squash' as const, available: true },
			{
				strategy: 'rebase' as const,
				available: false,
				reason: 'nothing_to_rebase' as const,
			},
			{
				strategy: 'fast_forward' as const,
				available: false,
				reason: 'not_fast_forward' as const,
			},
		]

		beforeEach(() => {
			vi.spyOn(
				gitStorageClient,
				'checkRepositoryMergeability'
			).mockResolvedValue({
				baseSha,
				headSha,
				mergeBaseSha: baseSha,
				mergeable: true,
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability,
			})
		})

		test('reports what every strategy could do with these branches', async () => {
			expect((await evaluate()).strategyAvailability).toEqual(
				strategyAvailability
			)
		})

		// A read has chosen nothing yet. Refusing it because one of the four is
		// impossible would make every diverged pull request look blocked.
		test('refuses nothing when no strategy was chosen', async () => {
			expect((await evaluate()).reasons).toEqual([])
		})

		test.each([
			'merge_commit',
			'squash',
		] as const)('clears %s, which these branches can run', async strategy => {
			expect((await evaluate({ strategy })).reasons).toEqual([])
		})

		test.each([
			{ strategy: 'rebase' as const, reason: 'nothing_to_rebase' },
			{ strategy: 'fast_forward' as const, reason: 'not_fast_forward' },
		])('refuses $strategy with its own reason', async ({
			strategy,
			reason,
		}) => {
			expect((await evaluate({ strategy })).reasons).toEqual([
				{ code: 'merge_strategy_unavailable', strategy, reason },
			])
		})

		// A conflict is a fact about the files and is said once, as itself. The
		// per-strategy entries still carry it for whoever is choosing.
		test('reports a conflict as a conflict rather than per strategy', async () => {
			vi.spyOn(
				gitStorageClient,
				'checkRepositoryMergeability'
			).mockResolvedValue({
				baseSha,
				headSha,
				mergeBaseSha: baseSha,
				mergeable: false,
				conflictPaths: ['src/index.ts'],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: strategyAvailability.map(entry => ({
					...entry,
					available: false,
					reason: 'conflict' as const,
				})),
			})

			expect((await evaluate({ strategy: 'rebase' })).reasons).toEqual([
				{ code: 'merge_conflict', baseSha, headSha },
			])
		})
	})

	test('allows an unprotected branch with nothing standing in the way', async () => {
		expect(await evaluate()).toEqual({
			eligible: true,
			evaluatedBaseSha: baseSha,
			evaluatedHeadSha: headSha,
			strategyAvailability: [
				{ strategy: 'merge_commit', available: true },
				{ strategy: 'squash', available: true },
				{ strategy: 'rebase', available: true },
				{ strategy: 'fast_forward', available: true },
			],
			rule: undefined,
			canBypass: false,
			reasons: [],
		})
	})

	test('reports the rule it judged against', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue(
			rule
		)

		expect((await evaluate()).rule).toEqual({
			id: ruleId,
			version: 3,
			targetBranch: 'main',
		})
	})

	test('refuses a read-only mirror and a viewer without write access', async () => {
		const { reasons } = await evaluate({
			tesseraWritesAllowed: false,
			viewerRole: 'read',
		})

		expect(reasons).toEqual([
			{ code: 'read_only_mirror', authority: 'github' },
			{
				code: 'insufficient_permission',
				requiredRole: 'write',
				actualRole: 'read',
			},
		])
	})

	test('stops at the state of a pull request that is no longer open', async () => {
		const { reasons } = await evaluate({
			pullRequest: { ...pullRequest, state: 'closed' },
		})

		expect(reasons).toEqual([
			{ code: 'pull_request_not_open', state: 'closed' },
		])
		expect(gitStorageClient.checkRepositoryMergeability).not.toHaveBeenCalled()
	})

	test('refuses a mirrored draft without asking Git anything', async () => {
		const { reasons } = await evaluate({
			pullRequest: gitHubPullRequest({ draft: true }),
			tesseraWritesAllowed: false,
		})

		expect(reasons).toContainEqual({ code: 'draft_pull_request' })
		expect(gitStorageClient.checkRepositoryMergeability).not.toHaveBeenCalled()
	})

	// A mirror is never merged from here, so the provider's own SHAs — the ones
	// its reviews and checks hang off — are the honest answer, and a Git round
	// trip describing a merge that is refused anyway would be wasted.
	test('answers a mirrored pull request from its provider mapping', async () => {
		const requirements = await evaluate({
			pullRequest: gitHubPullRequest(),
			tesseraWritesAllowed: false,
		})

		expect(requirements.evaluatedBaseSha).toBe(baseSha)
		expect(requirements.evaluatedHeadSha).toBe(headSha)
		expect(gitStorageClient.checkRepositoryMergeability).not.toHaveBeenCalled()
	})

	// Once the repository is cut over, Tessera merges its GitHub-mapped pull
	// requests from its own refs, so it has to judge those refs rather than the
	// SHAs the import left behind.
	test('evaluates a cutover GitHub-mapped pull request against live refs', async () => {
		const liveBaseSha = 'c'.repeat(40)
		const liveHeadSha = 'd'.repeat(40)
		vi.spyOn(gitStorageClient, 'checkRepositoryMergeability').mockResolvedValue(
			{
				baseSha: liveBaseSha,
				headSha: liveHeadSha,
				mergeBaseSha: liveBaseSha,
				mergeable: false,
				conflictPaths: ['src/index.ts'],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: [
					{ strategy: 'merge_commit', available: false, reason: 'conflict' },
					{ strategy: 'squash', available: false, reason: 'conflict' },
					{ strategy: 'rebase', available: false, reason: 'conflict' },
					{ strategy: 'fast_forward', available: false, reason: 'conflict' },
				],
			}
		)

		const requirements = await evaluate({
			pullRequest: gitHubPullRequest(),
			tesseraWritesAllowed: true,
		})

		expect(gitStorageClient.checkRepositoryMergeability).toHaveBeenCalledOnce()
		expect(requirements.evaluatedBaseSha).toBe(liveBaseSha)
		expect(requirements.evaluatedHeadSha).toBe(liveHeadSha)
		expect(requirements.reasons).toContainEqual({
			code: 'merge_conflict',
			baseSha: liveBaseSha,
			headSha: liveHeadSha,
		})
	})

	test('refuses refs that moved past what the caller expected', async () => {
		const { reasons } = await evaluate({
			expected: { baseSha: 'c'.repeat(40), headSha },
		})

		expect(reasons).toEqual([
			{
				code: 'stale_refs',
				expectedBaseSha: 'c'.repeat(40),
				actualBaseSha: baseSha,
				expectedHeadSha: headSha,
				actualHeadSha: headSha,
			},
		])
	})

	test('never reports stale refs for a read that expected nothing', async () => {
		expect((await evaluate()).reasons).toEqual([])
	})

	test('refuses a conflicting merge', async () => {
		vi.spyOn(gitStorageClient, 'checkRepositoryMergeability').mockResolvedValue(
			{
				baseSha,
				headSha,
				mergeBaseSha: baseSha,
				mergeable: false,
				conflictPaths: ['src/index.ts'],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: [
					{ strategy: 'merge_commit', available: false, reason: 'conflict' },
					{ strategy: 'squash', available: false, reason: 'conflict' },
					{ strategy: 'rebase', available: false, reason: 'conflict' },
					{ strategy: 'fast_forward', available: false, reason: 'conflict' },
				],
			}
		)

		expect((await evaluate()).reasons).toEqual([
			{ code: 'merge_conflict', baseSha, headSha },
		])
	})

	test('leaves reviews, checks and threads advisory without a rule', async () => {
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			review({ outcome: 'request_changes' }),
		])
		vi.spyOn(threadsRepository, 'countUnresolvedThreads').mockResolvedValue(4)

		expect((await evaluate()).reasons).toEqual([])
	})

	test('counts approvals against the rule and discounts stale ones', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 1,
		})
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			review({ outcome: 'approve', headSha: 'stale-head' }),
		])

		expect((await evaluate()).reasons).toEqual([
			{
				code: 'approvals_required',
				required: 1,
				approved: 0,
				staleApprovals: 1,
			},
		])
	})

	test('keeps counting a stale approval when the rule does not dismiss them', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 1,
			dismissStaleApprovals: false,
		})
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			review({ outcome: 'approve', headSha: 'stale-head' }),
		])

		expect((await evaluate()).reasons).toEqual([])
	})

	// The count reported is of approvals this rule actually discounted, not of
	// approvals that merely went stale: with the flag off nothing was discounted,
	// and saying otherwise would blame the shortfall on reviews that still count.
	test('reports no discounted approvals when the rule counts stale ones', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 2,
			dismissStaleApprovals: false,
		})
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			review({ outcome: 'approve', headSha: 'stale-head' }),
		])

		expect((await evaluate()).reasons).toEqual([
			{
				code: 'approvals_required',
				required: 2,
				approved: 1,
				staleApprovals: 0,
			},
		])
	})

	test('keeps a stale change request blocking under either flag', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			dismissStaleApprovals: true,
		})
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			review({ outcome: 'request_changes', headSha: 'stale-head' }),
		])

		expect((await evaluate()).reasons).toEqual([
			{
				code: 'changes_requested',
				reviewers: [
					expect.objectContaining({ outcome: 'request_changes', stale: true }),
				],
			},
		])
	})

	test('splits failing required checks from pending ones', async () => {
		const failing = {
			requirement: { context: 'build' },
			state: 'failure' as const,
			satisfied: false,
		}
		const pending = {
			requirement: { context: 'lint' },
			state: 'queued' as const,
			satisfied: false,
		}
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredCheckContexts: [{ context: 'build' }, { context: 'lint' }],
		})
		vi.spyOn(checksEvaluationService, 'evaluate').mockResolvedValue({
			headSha,
			perContext: [failing, pending],
			pending: [pending],
			failing: [failing],
			overall: 'failure',
		})

		expect((await evaluate()).reasons).toEqual([
			{ code: 'checks_failed', contexts: [failing] },
			{ code: 'checks_pending', contexts: [pending] },
		])
		expect(checksEvaluationService.evaluate).toHaveBeenCalledWith(
			repositoryId,
			headSha,
			[{ context: 'build' }, { context: 'lint' }]
		)
	})

	test('counts unresolved threads only when the rule requires resolution', async () => {
		vi.spyOn(threadsRepository, 'countUnresolvedThreads').mockResolvedValue(2)
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue(
			rule
		)

		expect((await evaluate()).reasons).toEqual([])

		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requireThreadsResolved: true,
		})

		expect((await evaluate()).reasons).toEqual([
			{ code: 'threads_unresolved', count: 2 },
		])
	})

	test('sends a direct merge to the queue when entries are waiting', async () => {
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(2)

		expect((await evaluate()).reasons).toEqual([
			{ code: 'merge_queue_required' },
		])
	})

	// The entry at the front has nothing ahead of it, so being queued is the whole
	// of what there is to say about its place.
	test('reports the pull request as already queued', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			id: entryId,
			pullRequestId,
			position: 1,
			state: 'queued',
			strategy: 'merge_commit',
			squashTitle: null,
			squashBody: null,
			blockingReasons: null,
			enqueuedByUserId: mockUserId,
			enqueuedAt: createdAt,
			stateChangedAt: createdAt,
		})
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockImplementation(
			async ({ beforePosition }) => (beforePosition === undefined ? 1 : 0)
		)

		expect((await evaluate()).reasons).toEqual([
			{ code: 'already_queued', state: 'queued' },
		])
	})

	// Being queued and being behind others are two different things to be told,
	// and the place is counted among the entries that can still run — the same way
	// the queue panel counts it, so the two numbers agree.
	test('reports how far back an entry that is not the head sits', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			id: entryId,
			pullRequestId,
			position: 9,
			state: 'queued',
			strategy: 'merge_commit',
			squashTitle: null,
			squashBody: null,
			blockingReasons: null,
			enqueuedByUserId: mockUserId,
			enqueuedAt: createdAt,
			stateChangedAt: createdAt,
		})
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockImplementation(
			async ({ beforePosition }) => (beforePosition === undefined ? 4 : 2)
		)

		expect((await evaluate()).reasons).toEqual([
			{ code: 'already_queued', state: 'queued' },
			{ code: 'not_queue_head', position: 3 },
		])
	})

	test('reads back why the queue paused the entry', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			id: entryId,
			pullRequestId,
			position: 1,
			state: 'paused',
			strategy: 'merge_commit',
			squashTitle: null,
			squashBody: null,
			blockingReasons: [{ code: 'threads_unresolved', count: 3 }],
			enqueuedByUserId: mockUserId,
			enqueuedAt: createdAt,
			stateChangedAt: createdAt,
		})

		expect((await evaluate()).reasons).toEqual([
			{
				code: 'queue_paused',
				reasons: [{ code: 'threads_unresolved', count: 3 }],
			},
		])
	})

	// Being queued is the reason this evaluation is happening, and the entry's turn
	// was settled by picking it, so the queue has nothing to tell its own entry.
	test('says nothing about the queue to the entry the queue is running', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			id: entryId,
			pullRequestId,
			position: 1,
			state: 'validating',
			strategy: 'merge_commit',
			squashTitle: null,
			squashBody: null,
			blockingReasons: null,
			enqueuedByUserId: mockUserId,
			enqueuedAt: createdAt,
			stateChangedAt: createdAt,
		})
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(3)

		expect((await evaluate({ queueEntryId: entryId })).reasons).toEqual([])
	})

	// Two entries for one pull request cannot exist, so an entry that is not this
	// one means the caller is somebody else and the queue still applies to it.
	test('still reports the queue to an evaluation for another entry', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			id: entryId,
			pullRequestId,
			position: 1,
			state: 'queued',
			strategy: 'merge_commit',
			squashTitle: null,
			squashBody: null,
			blockingReasons: null,
			enqueuedByUserId: mockUserId,
			enqueuedAt: createdAt,
			stateChangedAt: createdAt,
		})

		expect(
			(
				await evaluate({
					queueEntryId:
						'00000000-0000-4000-8000-000000000067' as typeof entryId,
				})
			).reasons
		).toEqual([{ code: 'already_queued', state: 'queued' }])
	})

	test('refuses while somebody else holds the repository lease', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue('another-attempt')

		expect((await evaluate()).reasons).toEqual([
			{ code: 'repository_merge_in_progress' },
		])
	})

	test('does not refuse the caller for holding the lease itself', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue('this-attempt')

		expect((await evaluate({ leaseOwner: 'this-attempt' })).reasons).toEqual([])
	})

	// A caller that took a lease and no longer appears on the row has lost it —
	// the hold aged out while the evaluation ran — and an expired hold of one's
	// own is exactly as disqualifying as somebody else's.
	test('refuses a merge whose own lease has already expired', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue(undefined)

		expect((await evaluate({ leaseOwner: 'this-attempt' })).reasons).toEqual([
			{ code: 'repository_merge_in_progress' },
		])
	})

	test('leaves a read that took no lease alone when the repository is free', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue(undefined)

		expect((await evaluate()).reasons).toEqual([])
	})

	test('still refuses a merge whose lease was taken by somebody else', async () => {
		vi.spyOn(
			mergeQueueRepository,
			'findRepositoryMergeLeaseOwner'
		).mockResolvedValue('another-attempt')

		expect((await evaluate({ leaseOwner: 'this-attempt' })).reasons).toEqual([
			{ code: 'repository_merge_in_progress' },
		])
	})

	test('orders reasons the same way however they were found', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 1,
			requireThreadsResolved: true,
		})
		vi.spyOn(threadsRepository, 'countUnresolvedThreads').mockResolvedValue(1)
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(1)
		vi.spyOn(gitStorageClient, 'checkRepositoryMergeability').mockResolvedValue(
			{
				baseSha,
				headSha,
				mergeBaseSha: baseSha,
				mergeable: false,
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: [
					{ strategy: 'merge_commit', available: false, reason: 'conflict' },
					{ strategy: 'squash', available: false, reason: 'conflict' },
					{ strategy: 'rebase', available: false, reason: 'conflict' },
					{ strategy: 'fast_forward', available: false, reason: 'conflict' },
				],
			}
		)

		expect((await evaluate()).reasons.map(reason => reason.code)).toEqual([
			'merge_conflict',
			'approvals_required',
			'threads_unresolved',
			'merge_queue_required',
		])
	})

	test('offers a bypass only for waivable blockers to a qualifying role', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 1,
			bypassMinimumRole: 'admin',
		})

		expect((await evaluate({ viewerRole: 'admin' })).canBypass).toBe(true)
		expect((await evaluate({ viewerRole: 'write' })).canBypass).toBe(false)
	})

	test('withdraws the bypass when a never-waivable blocker is present', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			requiredApprovals: 1,
			bypassMinimumRole: 'admin',
		})
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(1)

		expect((await evaluate({ viewerRole: 'admin' })).canBypass).toBe(false)
	})

	test('offers no bypass when there is nothing to bypass', async () => {
		vi.spyOn(branchProtectionService, 'findRuleForBranch').mockResolvedValue({
			...rule,
			bypassMinimumRole: 'admin',
		})

		expect((await evaluate({ viewerRole: 'owner' })).canBypass).toBe(false)
	})
})
