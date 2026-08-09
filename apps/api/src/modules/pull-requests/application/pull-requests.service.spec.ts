import {
	GitStorageClient,
	type GitStorageRepositoryComparison,
} from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { ChecksReadService } from '@modules/checks'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { MergeRequirements } from '@repo/contracts'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import {
	PullRequestAlreadyOpenError,
	PullRequestInvalidBranchesError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestReviewNotFoundError } from '../domain/pull-request-review.errors'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import {
	type PullRequestReviewReadModel,
	PullRequestReviewsRepository,
} from '../infrastructure/pull-request-reviews.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { MergeQueueStatusService } from './merge-queue-status.service'
import { MergeRequirementsService } from './merge-requirements.service'
import { PullRequestHeadResolver } from './pull-request-head.resolver'
import { PullRequestMergeRunner } from './pull-request-merge.runner'
import {
	type PullRequestReviewState,
	PullRequestReviewsService,
} from './pull-request-reviews.service'
import { PullRequestsService } from './pull-requests.service'

const emptyReviewState: PullRequestReviewState = {
	reviewerRequests: [],
	reviews: [],
	effectiveReviewStates: [],
	reviewerCandidates: [],
	viewer: {
		canSubmitReview: false,
		canRequestReviewers: false,
		canRemoveReviewerRequests: false,
	},
}
const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const createdAt = new Date('2026-07-11T00:00:00Z')
const repositoryContext = {
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
}
const repositoryAccessContext = {
	...repositoryContext,
	viewerRole: 'write' as const,
	tesseraWritesAllowed: true,
}
const pullRequest: PullRequest = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'head-sha',
	title: 'Add feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const event: PullRequestEvent = {
	id: '00000000-0000-4000-8000-000000000045' as PullRequestEventId,
	pullRequestId,
	provider: 'tessera',
	actorUserId: mockUserId,
	type: 'opened',
	payload: null,
	createdAt,
}
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
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
	reasons: [
		{ code: 'approvals_required', required: 2, approved: 0, staleApprovals: 0 },
	],
}
const mergeActor = {
	id: mockUserId,
	name: 'Ada',
	email: 'ada@example.com',
}
const mergeInput = {
	...repositoryInput,
	number: 1,
	expectedBaseSha: 'a'.repeat(40),
	expectedHeadSha: 'b'.repeat(40),
}
const reviewId = '00000000-0000-4000-8000-000000000077' as PullRequestReviewId
const reviewHeadSha = 'd'.repeat(40)
const currentHeadSha = 'e'.repeat(40)
const reviewComparisonInput = { ...repositoryInput, number: 1, reviewId }
const noActor = {
	userId: null,
	username: null,
	externalNodeId: null,
	externalLogin: null,
	externalAvatarUrl: null,
	externalHtmlUrl: null,
}
const submittedReview: PullRequestReviewReadModel = {
	id: reviewId,
	reviewer: { ...noActor, userId: mockUserId, username: 'ada' },
	state: 'submitted',
	outcome: 'approve',
	body: 'Looks good',
	headSha: reviewHeadSha,
	submittedAt: createdAt,
	dismissedAt: null,
	dismissedBy: noActor,
	sourceUrl: null,
}
const canonicalComparison: GitStorageRepositoryComparison = {
	baseSha: 'base-sha',
	headSha: currentHeadSha,
	mergeBaseSha: 'base-sha',
	commits: [],
	files: [],
	isTruncated: false,
	commitsTruncated: false,
	commitLimit: 500,
	fileLimit: 300,
}
const reviewComparison: GitStorageRepositoryComparison = {
	...canonicalComparison,
	baseSha: reviewHeadSha,
	mergeBaseSha: reviewHeadSha,
	commits: [
		{
			sha: currentHeadSha,
			shortSha: currentHeadSha.slice(0, 7),
			summary: 'Address review feedback',
			author: undefined,
		},
		{
			sha: 'f'.repeat(40),
			shortSha: 'fffffff',
			summary: 'Rename the helper',
			author: undefined,
		},
	],
}

describe(PullRequestsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestsService
	let repository: PullRequestsRepository
	let checksReadService: ChecksReadService
	let repositoriesService: RepositoriesService
	let reviewsRepository: PullRequestReviewsRepository
	let gitStorageClient: GitStorageClient
	let mergeRequirementsService: MergeRequirementsService
	let mergeQueueRepository: MergeQueueRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestsService,
				{
					provide: PullRequestsRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						find: vi.fn(),
						findById: vi.fn(),
						listEvents: vi.fn(),
						edit: vi.fn(),
						close: vi.fn(),
						reopen: vi.fn(),
						claimMerge: vi.fn(),
						completeMerge: vi.fn(),
						releaseMerge: vi.fn(),
						recordMergeBlocked: vi.fn(),
					},
				},
				{
					provide: PullRequestReviewsRepository,
					useValue: { findReview: vi.fn() },
				},
				{
					provide: PullRequestReviewsService,
					useValue: {
						getReviewState: vi.fn().mockResolvedValue(emptyReviewState),
						listReviewSummaries: vi.fn().mockResolvedValue(new Map()),
					},
				},
				PullRequestHeadResolver,
				{
					provide: ChecksReadService,
					useValue: {
						findSummary: vi.fn(),
						listSummaries: vi.fn().mockResolvedValue(new Map()),
						listChecks: vi.fn(),
					},
				},
				{
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
						getWritableRepositoryContext: vi.fn(),
					},
				},
				{
					provide: MergeRequirementsService,
					useValue: { evaluate: vi.fn() },
				},
				{
					provide: MergeQueueStatusService,
					useValue: {
						getStatus: vi.fn().mockResolvedValue({ runnableCount: 0 }),
					},
				},
				// The merge core is exercised for real: the endpoint's job is deciding
				// whether to merge, and a stubbed merge would prove nothing about the
				// decisions it hands over.
				PullRequestMergeRunner,
				{
					provide: MergeQueueRepository,
					useValue: {
						acquireRepositoryMergeLease: vi.fn(),
						renewRepositoryMergeLease: vi.fn(),
						releaseRepositoryMergeLease: vi.fn(),
						findActiveEntry: vi.fn(),
						countRunnableEntries: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						listRepositoryRefs: vi.fn(),
						compareRepositoryRefs: vi.fn(),
						getRepositoryFileDiff: vi.fn(),
						getRepositoryBlob: vi.fn(),
						mergeRepositoryRefs: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestsService)
		repository = moduleRef.get(PullRequestsRepository)
		checksReadService = moduleRef.get(ChecksReadService)
		repositoriesService = moduleRef.get(RepositoriesService)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)
		mergeRequirementsService = moduleRef.get(MergeRequirementsService)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)

		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			eligibleRequirements
		)
		vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		).mockResolvedValue(true)
		vi.spyOn(
			mergeQueueRepository,
			'renewRepositoryMergeLease'
		).mockResolvedValue(true)
		vi.spyOn(
			mergeQueueRepository,
			'releaseRepositoryMergeLease'
		).mockResolvedValue()
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(
			undefined
		)
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(0)

		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue(repositoryAccessContext)
		vi.spyOn(
			repositoriesService,
			'getWritableRepositoryContext'
		).mockResolvedValue(repositoryAccessContext)
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'base-sha',
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'head-sha',
				},
			],
			tags: [],
		})
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a pull request from current branch heads', async () => {
		const createSpy = vi
			.spyOn(repository, 'create')
			.mockResolvedValue(pullRequest)

		expect(
			await service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
				body: undefined,
			})
		).toEqual(expect.objectContaining({ number: 1, state: 'open' }))
		expect(createSpy).toHaveBeenCalledWith({
			repositoryId,
			authorUserId: mockUserId,
			sourceBranch: 'feature',
			targetBranch: 'main',
			openingBaseSha: 'base-sha',
			openingHeadSha: 'head-sha',
			title: 'Add feature',
			body: '',
		})
	})

	test('rejects missing branches', async () => {
		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'missing',
				targetBranch: 'main',
				title: 'Invalid',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestInvalidBranchesError)
	})

	test('rejects branches resolving to the same revision', async () => {
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'same',
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'same',
				},
			],
			tags: [],
		})

		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'No changes',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestNoChangesError)
	})

	test('maps open branch pair uniqueness to a conflict', async () => {
		vi.spyOn(repository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'pull_requests_open_branch_pair_unique',
		})

		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Duplicate',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestAlreadyOpenError)
	})

	test('lists readable repository pull requests by state', async () => {
		const listSpy = vi
			.spyOn(repository, 'list')
			.mockResolvedValue([pullRequest])

		const result = await service.list(undefined, {
			...repositoryInput,
			state: 'open',
		})

		expect(result.pullRequests).toHaveLength(1)
		expect(result.viewerRole).toBe('write')
		expect(listSpy).toHaveBeenCalledWith({ repositoryId, state: 'open' })
	})

	test('gets a pull request with lifecycle events', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'listEvents').mockResolvedValue([event])

		expect(
			await service.get(undefined, { ...repositoryInput, number: 1 })
		).toEqual({
			pullRequest: expect.objectContaining({ id: pullRequestId }),
			events: [{ ...event, actorUsername: 'marta', payload: undefined }],
			...emptyReviewState,
			checksSummary: undefined,
			mergeQueue: { runnableCount: 0 },
			authority: 'tessera',
			viewerRole: 'write',
		})
	})

	test('returns GitHub provider actors instead of the repository owner', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			provider: 'github',
			authorUserId: null,
			authorUsername: 'octocat',
			github: {
				nodeId: 'PR_kwDOExample',
				htmlUrl: 'https://github.com/octocat/notes/pull/1',
				draft: false,
				headSha: 'head-sha',
				baseSha: 'base-sha',
				mergedByUsername: 'hubot',
			},
		})
		vi.spyOn(repository, 'listEvents').mockResolvedValue([
			{
				...event,
				provider: 'github',
				actorUserId: null,
				actorUsername: 'reviewer',
			},
		])

		const result = await service.get(undefined, {
			...repositoryInput,
			number: 1,
		})

		expect(result.pullRequest.authorUsername).toBe('octocat')
		expect(result.pullRequest.github?.mergedByUsername).toBe('hubot')
		expect(result.events[0]?.actorUsername).toBe('reviewer')
	})

	test('rejects missing pull requests', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(undefined)

		await expect(
			service.get(undefined, { ...repositoryInput, number: 404 })
		).rejects.toBeInstanceOf(PullRequestNotFoundError)
	})

	test('edits a non-merged pull request and records through the repository', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const editSpy = vi
			.spyOn(repository, 'edit')
			.mockResolvedValue({ ...pullRequest, title: 'Updated' })

		expect(
			await service.edit(mockUserId, {
				...repositoryInput,
				number: 1,
				title: 'Updated',
				body: undefined,
			})
		).toEqual(expect.objectContaining({ title: 'Updated' }))
		expect(editSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: mockUserId,
				expectedState: 'open',
			})
		)
	})

	test('rejects edits on merged pull requests', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			closedAt: createdAt,
			mergedAt: createdAt,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
		})
		const editSpy = vi.spyOn(repository, 'edit')

		await expect(
			service.edit(mockUserId, {
				...repositoryInput,
				number: 1,
				title: 'Updated',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
		expect(editSpy).not.toHaveBeenCalled()
	})

	test('closes and reopens through state-checked repository mutations', async () => {
		const findSpy = vi.spyOn(repository, 'find')
		findSpy.mockResolvedValueOnce(pullRequest).mockResolvedValueOnce({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'close').mockResolvedValue({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'reopen').mockResolvedValue(pullRequest)

		expect(
			await service.close(mockUserId, { ...repositoryInput, number: 1 })
		).toEqual(expect.objectContaining({ state: 'closed' }))
		expect(
			await service.reopen(mockUserId, { ...repositoryInput, number: 1 })
		).toEqual(expect.objectContaining({ state: 'open' }))
	})

	test('rejects stale lifecycle updates', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'close').mockResolvedValue(undefined)

		await expect(
			service.close(mockUserId, { ...repositoryInput, number: 1 })
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
	})

	test('maps reopen branch pair uniqueness to a conflict', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'reopen').mockRejectedValue({
			code: '23505',
			constraint: 'pull_requests_open_branch_pair_unique',
		})

		await expect(
			service.reopen(mockUserId, { ...repositoryInput, number: 1 })
		).rejects.toBeInstanceOf(PullRequestAlreadyOpenError)
	})

	test('returns the current three-dot branch comparison', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'base-sha',
				headSha: 'head-sha',
				mergeBaseSha: 'merge-base-sha',
				commits: [
					{
						sha: 'commit-sha',
						shortSha: 'commit-',
						summary: 'Feature',
						author: {
							name: 'Ada',
							email: 'ada@example.com',
							date: '2026-07-11T00:00:00Z',
						},
					},
				],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		expect(
			await service.comparison(undefined, {
				...repositoryInput,
				number: 1,
			})
		).toMatchObject({
			commits: [{ author: { date: new Date('2026-07-11T00:00:00Z') } }],
		})
		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'main',
			headRef: 'feature',
		})
	})

	test('uses the persisted merge commit parents for merged comparisons', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'c'.repeat(40),
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				commits: [],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: `${'c'.repeat(40)}^1`,
			headRef: `${'c'.repeat(40)}^2`,
		})
	})

	test('uses provider SHAs for merged GitHub comparisons', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			provider: 'github',
			authorUserId: null,
			authorUsername: 'octocat',
			state: 'merged',
			mergeCommitSha: 'c'.repeat(40),
			mergeActorUserId: null,
			mergedAt: createdAt,
			closedAt: createdAt,
			github: {
				nodeId: 'PR_kwDOExample',
				htmlUrl: 'https://github.com/octocat/notes/pull/1',
				draft: false,
				headSha: 'b'.repeat(40),
				baseSha: 'a'.repeat(40),
			},
		})
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				commits: [],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'a'.repeat(40),
			headRef: 'b'.repeat(40),
		})
	})

	test('returns what the current head holds beyond a reviewed commit', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValueOnce(canonicalComparison)
			.mockResolvedValueOnce(reviewComparison)
		const listSummariesSpy = vi.spyOn(checksReadService, 'listSummaries')

		expect(
			await service.reviewComparison(undefined, reviewComparisonInput)
		).toMatchObject({
			status: 'ready',
			review: {
				id: reviewId,
				reviewer: { username: 'ada' },
				state: 'submitted',
				outcome: 'approve',
				headSha: reviewHeadSha,
			},
			canonicalBaseSha: 'base-sha',
			currentHeadSha,
			historiesDiverged: false,
			comparison: { baseSha: reviewHeadSha, headSha: currentHeadSha },
		})
		expect(compareSpy).toHaveBeenLastCalledWith({
			...repositoryContext,
			baseRef: reviewHeadSha,
			headRef: currentHeadSha,
		})
		// The interdiff commit rows carry the same batched check rollups the full
		// comparison shows, with only the current head marked current.
		expect(listSummariesSpy).toHaveBeenLastCalledWith({
			heads: [
				{ key: currentHeadSha, sha: currentHeadSha, isCurrent: true },
				{ key: 'f'.repeat(40), sha: 'f'.repeat(40), isCurrent: false },
			],
			repositoryId,
		})
	})

	test('discloses that the reviewed history diverged from the current head', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValueOnce(canonicalComparison)
			.mockResolvedValueOnce({
				...reviewComparison,
				mergeBaseSha: 'ancestor-sha',
			})

		expect(
			await service.reviewComparison(undefined, reviewComparisonInput)
		).toMatchObject({ status: 'ready', historiesDiverged: true })
	})

	test('reports nothing new when the review already covers the current head', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue({
			...submittedReview,
			headSha: currentHeadSha,
		})
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue(canonicalComparison)

		expect(
			await service.reviewComparison(undefined, reviewComparisonInput)
		).toMatchObject({
			status: 'nothing_new',
			canonicalBaseSha: 'base-sha',
			currentHeadSha,
		})
		expect(compareSpy).toHaveBeenCalledTimes(1)
	})

	// The pull request's own comparison already resolved against this repository,
	// so the only object the second call can be missing is the reviewed commit.
	test('reports an unavailable reviewed head when storage no longer holds it', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValueOnce(canonicalComparison)
			.mockRejectedValueOnce(
				new ExternalServiceError('git storage', { grpcCode: status.NOT_FOUND })
			)

		expect(
			await service.reviewComparison(undefined, reviewComparisonInput)
		).toMatchObject({
			status: 'review_head_unavailable',
			review: { headSha: reviewHeadSha },
			currentHeadSha,
		})
	})

	test('keeps storage failures that are not a missing commit as failures', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValueOnce(canonicalComparison)
			.mockRejectedValueOnce(
				new ExternalServiceError('git storage', { grpcCode: status.INTERNAL })
			)

		await expect(
			service.reviewComparison(undefined, reviewComparisonInput)
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test('keeps a missing canonical comparison as a failure', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.NOT_FOUND })
		)

		await expect(
			service.reviewComparison(undefined, reviewComparisonInput)
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test.each([
		['a review of another pull request', undefined],
		[
			'a review still pending',
			{ ...submittedReview, state: 'pending' as const },
		],
	])('refuses to compare against %s', async (_context, review) => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(review)
		const compareSpy = vi.spyOn(gitStorageClient, 'compareRepositoryRefs')

		await expect(
			service.reviewComparison(undefined, reviewComparisonInput)
		).rejects.toBeInstanceOf(PullRequestReviewNotFoundError)
		expect(compareSpy).not.toHaveBeenCalled()
	})

	test('pins lazy file diffs to the displayed comparison SHAs', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const fileDiffSpy = vi
			.spyOn(gitStorageClient, 'getRepositoryFileDiff')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				file: {
					status: 'modified',
					oldPath: 'src/index.ts',
					newPath: 'src/index.ts',
					additions: 1,
					deletions: 0,
					isBinary: false,
				},
				hunks: [],
				isTruncated: false,
				patchLimitBytes: 2_097_152,
			})

		await service.fileDiff(undefined, {
			...repositoryInput,
			number: 1,
			path: 'src/index.ts',
			expectedBaseSha: 'a'.repeat(40),
			expectedHeadSha: 'b'.repeat(40),
		})

		expect(fileDiffSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'a'.repeat(40),
			headRef: 'b'.repeat(40),
			path: 'src/index.ts',
		})
	})

	test('claims the merge before Git and completes persistence afterward', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const claimMergeSpy = vi
			.spyOn(repository, 'claimMerge')
			.mockResolvedValue(pullRequest)
		const mergeGitSpy = vi
			.spyOn(gitStorageClient, 'mergeRepositoryRefs')
			.mockResolvedValue('merge-sha')
		const completeMergeSpy = vi
			.spyOn(repository, 'completeMerge')
			.mockResolvedValue({
				...pullRequest,
				state: 'merged',
				mergeCommitSha: 'merge-sha',
				mergeActorUserId: mockUserId,
				mergedAt: createdAt,
				closedAt: createdAt,
			})

		expect(
			await service.merge(
				{
					id: mockUserId,
					name: 'Ada',
					email: 'ada@example.com',
				},
				{
					...repositoryInput,
					number: 1,
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
				}
			)
		).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: 'merge-sha' },
		})
		expect(mergeGitSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: pullRequestId,
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
			})
		)
		expect(claimMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				attemptId: expect.any(String),
			})
		)
		expect(completeMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				mergeCommitSha: 'merge-sha',
				attemptId: expect.any(String),
			})
		)
		expect(claimMergeSpy.mock.invocationCallOrder[0]).toBeLessThan(
			mergeGitSpy.mock.invocationCallOrder[0] ?? 0
		)
		expect(mergeGitSpy.mock.invocationCallOrder[0]).toBeLessThan(
			completeMergeSpy.mock.invocationCallOrder[0] ?? 0
		)
	})

	test('returns the concurrent persisted merge after Git idempotency wins', async () => {
		const mergedPullRequest = {
			...pullRequest,
			state: 'merged' as const,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		}
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'findById').mockResolvedValue(mergedPullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
			'merge-sha'
		)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue(undefined)

		expect(
			await service.merge(
				{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
				{
					...repositoryInput,
					number: 1,
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
				}
			)
		).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: 'merge-sha' },
		})
	})

	test('releases the merge intent after a deterministic stale-ref failure', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.ABORTED })
		)
		const releaseMergeSpy = vi
			.spyOn(repository, 'releaseMerge')
			.mockResolvedValue()

		await service.merge(
			{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
			{
				...repositoryInput,
				number: 1,
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
			}
		)

		expect(releaseMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				attemptId: expect.any(String),
			})
		)
	})

	// Git compared and swapped against the refs the evaluation resolved and
	// refused. That is the authoritative verdict on the same world the
	// requirements described, so it comes back as a refusal of the merge and is
	// audited like every other one — an error here would leave the strongest
	// answer of all out of the trail.
	test('reports a refs-moved refusal as a blocked merge, freshly evaluated', async () => {
		const staleRefsRequirements: MergeRequirements = {
			...blockedRequirements,
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
		}

		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.ABORTED })
		)
		const evaluateSpy = vi
			.spyOn(mergeRequirementsService, 'evaluate')
			.mockResolvedValueOnce(eligibleRequirements)
			.mockResolvedValue(staleRefsRequirements)
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toEqual({
			status: 'blocked',
			requirements: staleRefsRequirements,
		})
		// The refs Git rejected are what the second evaluation is asked about, so
		// the answer names what moved rather than only that something did.
		expect(evaluateSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				expected: { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) },
				leaseOwner: expect.any(String),
			})
		)
		expect(recordMergeBlockedSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				payload: expect.objectContaining({ reasonCodes: ['stale_refs'] }),
			})
		)
	})

	// The refs moved back, or another attempt is finishing the same merge, so a
	// fresh look finds nothing to report. What Git objected to is still recorded,
	// from what the refused attempt knew.
	test('records what Git refused when the fresh look has nothing to say', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.FAILED_PRECONDITION,
				grpcDetails: 'repository refs cannot be merged cleanly',
			})
		)
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
			status: 'blocked',
			requirements: {
				eligible: false,
				reasons: [
					{
						code: 'merge_conflict',
						baseSha: 'a'.repeat(40),
						headSha: 'b'.repeat(40),
					},
				],
			},
		})
		expect(recordMergeBlockedSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ reasonCodes: ['merge_conflict'] }),
			})
		)
	})

	// Git failing to answer at all is not a verdict on the merge, so it stays an
	// error the caller can retry rather than a refusal it would act on.
	test('still raises a transport failure rather than reporting it as blocked', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.UNAVAILABLE,
			})
		)

		await expect(service.merge(mergeActor, mergeInput)).rejects.toThrow()
	})

	test('merges the refs the evaluation resolved, not the ones the caller sent', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue({
			...eligibleRequirements,
			evaluatedBaseSha: 'c'.repeat(40),
			evaluatedHeadSha: 'd'.repeat(40),
		})
		const mergeGitSpy = vi
			.spyOn(gitStorageClient, 'mergeRepositoryRefs')
			.mockResolvedValue('merge-sha')

		await service.merge(mergeActor, mergeInput)

		expect(mergeGitSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
			})
		)
	})

	test('refuses a blocked merge as a result and audits the attempt', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)
		const claimMergeSpy = vi.spyOn(repository, 'claimMerge')
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toEqual({
			status: 'blocked',
			requirements: blockedRequirements,
		})
		expect(claimMergeSpy).not.toHaveBeenCalled()
		expect(recordMergeBlockedSpy).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			payload: {
				ruleId: undefined,
				ruleVersion: undefined,
				reasonCodes: ['approvals_required'],
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
			},
		})
	})

	test('merges past waivable blockers when the evaluation offered a bypass', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue({
			...blockedRequirements,
			canBypass: true,
		})
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
			'merge-sha'
		)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		const claimMergeSpy = vi
			.spyOn(repository, 'claimMerge')
			.mockResolvedValue(pullRequest)
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(
			await service.merge(mergeActor, {
				...mergeInput,
				bypass: { reason: 'Production incident' },
			})
		).toMatchObject({ status: 'merged' })
		expect(recordMergeBlockedSpy).not.toHaveBeenCalled()
		// The audit travels with the claim so a crash before completion cannot lose
		// the fact that policy was waived.
		expect(claimMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				bypass: {
					ruleId: undefined,
					ruleVersion: undefined,
					reason: 'Production incident',
					bypassedReasonCodes: ['approvals_required'],
					baseSha: 'a'.repeat(40),
					headSha: 'b'.repeat(40),
				},
			})
		)
	})

	test('refuses a bypass the evaluation did not offer', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()
		const claimMergeSpy = vi.spyOn(repository, 'claimMerge')

		expect(
			await service.merge(mergeActor, {
				...mergeInput,
				bypass: { reason: 'Ship it' },
			})
		).toMatchObject({ status: 'blocked' })
		expect(claimMergeSpy).not.toHaveBeenCalled()
	})

	test('refuses a merge the caller has no authority for without taking the repository', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			...repositoryAccessContext,
			viewerRole: 'read',
			tesseraWritesAllowed: false,
		})
		const acquireLeaseSpy = vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		)
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toEqual({
			status: 'blocked',
			requirements: {
				eligible: false,
				canBypass: false,
				reasons: [
					{ code: 'read_only_mirror', authority: 'github' },
					{
						code: 'insufficient_permission',
						requiredRole: 'write',
						actualRole: 'read',
					},
				],
			},
		})
		expect(acquireLeaseSpy).not.toHaveBeenCalled()
		// Refused before anything was evaluated, so the audit names only the codes:
		// no refs were resolved and no rule was consulted.
		expect(recordMergeBlockedSpy).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			payload: {
				reasonCodes: ['read_only_mirror', 'insufficient_permission'],
			},
		})
	})

	test('refuses to merge while another merge holds the repository', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		).mockResolvedValue(false)
		const evaluateSpy = vi.spyOn(mergeRequirementsService, 'evaluate')
		const recordMergeBlockedSpy = vi
			.spyOn(repository, 'recordMergeBlocked')
			.mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toEqual({
			status: 'blocked',
			requirements: {
				eligible: false,
				canBypass: false,
				reasons: [{ code: 'repository_merge_in_progress' }],
			},
		})
		expect(evaluateSpy).not.toHaveBeenCalled()
		expect(recordMergeBlockedSpy).toHaveBeenCalledWith({
			pullRequestId,
			actorUserId: mockUserId,
			payload: { reasonCodes: ['repository_merge_in_progress'] },
		})
	})

	// A refusal reached before evaluation names no evaluated SHAs, and that
	// absence is what tells it apart from one the evaluation itself returned.
	test('reports a refusal reached before evaluation without evaluated refs', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(
			mergeQueueRepository,
			'acquireRepositoryMergeLease'
		).mockResolvedValue(false)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()

		const result = await service.merge(mergeActor, mergeInput)

		expect(result.status).toBe('blocked')
		expect(
			result.status === 'blocked' && result.requirements.evaluatedBaseSha
		).toBeFalsy()
		expect(
			result.status === 'blocked' && result.requirements.evaluatedHeadSha
		).toBeFalsy()
	})

	test('abandons the merge when the lease was lost between evaluation and Git', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(
			mergeQueueRepository,
			'renewRepositoryMergeLease'
		).mockResolvedValue(false)
		const mergeGitSpy = vi.spyOn(gitStorageClient, 'mergeRepositoryRefs')
		const releaseMergeSpy = vi
			.spyOn(repository, 'releaseMerge')
			.mockResolvedValue()
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toEqual({
			status: 'blocked',
			requirements: {
				eligible: false,
				canBypass: false,
				reasons: [{ code: 'repository_merge_in_progress' }],
			},
		})
		expect(mergeGitSpy).not.toHaveBeenCalled()
		// The claim is given back rather than left to age out, so whoever holds the
		// repository now is not shut out of this pull request for a minute.
		expect(releaseMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({ pullRequestId, attemptId: expect.any(String) })
		)
	})

	test('releases the repository lease even when the merge fails', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.UNAVAILABLE,
			})
		)
		vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
		const releaseLeaseSpy = vi.spyOn(
			mergeQueueRepository,
			'releaseRepositoryMergeLease'
		)

		await expect(service.merge(mergeActor, mergeInput)).rejects.toThrow()
		expect(releaseLeaseSpy).toHaveBeenCalledWith({
			repositoryId,
			owner: expect.any(String),
		})
	})

	// The merge is already committed by the time the lease is given back, and the
	// lease expires on its own, so a failed release must not turn a completed
	// merge into an error the caller would retry.
	test('keeps the merge result when the lease cannot be released', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
			'merge-sha'
		)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		vi.spyOn(
			mergeQueueRepository,
			'releaseRepositoryMergeLease'
		).mockRejectedValue(new Error('connection terminated'))

		expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: 'merge-sha' },
		})
	})

	test('evaluates requirements without auditing the question', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)
		const recordMergeBlockedSpy = vi.spyOn(repository, 'recordMergeBlocked')

		expect(
			await service.getMergeRequirements(mockUserId, {
				...repositoryInput,
				number: 1,
			})
		).toEqual(blockedRequirements)
		expect(recordMergeBlockedSpy).not.toHaveBeenCalled()
	})

	test('reads checks for the commit the caller named, not the head it resolved', async () => {
		const checksReadService = moduleRef.get(ChecksReadService)
		const expectedHeadSha = 'c'.repeat(40)
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const listChecksSpy = vi
			.spyOn(checksReadService, 'listChecks')
			.mockResolvedValue({
				checks: [],
				headSha: expectedHeadSha,
				headIsCurrent: false,
			})

		await service.listChecks(mockUserId, {
			...repositoryInput,
			number: 1,
			expectedHeadSha,
		})

		// 'head-sha' is where the branch actually points; the caller asked about an
		// older commit and must be told about that one, marked as no longer current.
		expect(listChecksSpy).toHaveBeenCalledWith({
			repositoryId,
			head: { sha: expectedHeadSha, isCurrent: false },
		})
	})

	test('keeps the checks answer current when the caller named the live head', async () => {
		const checksReadService = moduleRef.get(ChecksReadService)
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const listChecksSpy = vi
			.spyOn(checksReadService, 'listChecks')
			.mockResolvedValue({
				checks: [],
				headSha: 'head-sha',
				headIsCurrent: true,
			})

		await service.listChecks(mockUserId, {
			...repositoryInput,
			number: 1,
			expectedHeadSha: 'head-sha',
		})

		expect(listChecksSpy).toHaveBeenCalledWith({
			repositoryId,
			head: { sha: 'head-sha', isCurrent: true },
		})
	})
})
