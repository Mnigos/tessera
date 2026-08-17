import {
	GitStorageClient,
	type GitStorageRepositoryComparison,
} from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { BranchProtectionService } from '@modules/branch-protection'
import { ChecksReadService } from '@modules/checks'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import { GitHubWriteThroughService } from '@modules/github-write-through'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { MergeRequirements } from '@repo/contracts'
import type { GitHubActorId, PullRequest, PullRequestEvent } from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import { RepositoryMergeInProgressError } from '../domain/merge-queue.errors'
import {
	PullRequestAlreadyOpenError,
	PullRequestFileContentNotFoundError,
	PullRequestInvalidBranchesError,
	PullRequestMergeInProgressError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestQueuedError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestReviewNotFoundError } from '../domain/pull-request-review.errors'
import type { PullRequestMergeRequest } from '../helpers/pull-request-merge-request'
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
		allowedOutcomes: [],
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
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffStatsUpdatedAt: null,
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
	idempotencyKey: null,
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
	strategy: 'merge_commit' as const,
}
/**
 * A claim with no abandoned intent to take over, which hands back exactly the
 * request the attempt arrived with.
 */
const claimMerge = async ({
	request,
}: {
	request: PullRequestMergeRequest
}) => ({ pullRequest, request })
const reviewId = '00000000-0000-4000-8000-000000000077' as PullRequestReviewId
const reviewHeadSha = 'd'.repeat(40)
const currentHeadSha = 'e'.repeat(40)
const reviewComparisonInput = { ...repositoryInput, number: 1, reviewId }
const noActor = {
	userId: null,
	username: null,
	displayName: null,
	imageUrl: null,
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
const gitHubPullRequest = {
	nodeId: 'github-pull-request-node',
	numericId: 101n,
	number: 77,
	htmlUrl: 'https://github.com/marta/notes/pull/77',
	title: 'Synchronized pull request',
	body: '',
	state: 'open',
	draft: false,
	labels: [],
	assignees: [],
	author: {
		nodeId: 'github-user-node',
		numericId: 7n,
		login: 'marta',
		type: 'user',
	},
	sourceBranch: 'feature',
	targetBranch: 'main',
	headRepositoryNodeId: 'repository-node',
	baseRepositoryNodeId: 'repository-node',
	headSha: 'b'.repeat(40),
	baseSha: 'a'.repeat(40),
	createdAt,
	updatedAt: createdAt,
} satisfies GitHubSyncPullRequest
const gitHubActorId = '00000000-0000-4000-8000-000000000099' as GitHubActorId

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
	let gitHubWriteThroughService: GitHubWriteThroughService

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
						retarget: vi.fn(),
						claimMerge: vi.fn(),
						findRecoverableMergeIntent: vi.fn(),
						completeMerge: vi.fn(),
						releaseMerge: vi.fn(),
						recordMergeBlocked: vi.fn(),
						writeDiffStats: vi.fn(),
						clearDiffStats: vi.fn(),
						reconcileGitHubPullRequest: vi.fn(),
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
					provide: BranchProtectionService,
					useValue: { findRuleForBranch: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
						getPullRequestWriteContext: vi.fn(),
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
						findMergeReceipt: vi.fn(),
					},
				},
				{
					provide: GitHubWriteThroughService,
					useValue: { mergePullRequest: vi.fn(), updatePullRequest: vi.fn() },
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
		gitHubWriteThroughService = moduleRef.get(GitHubWriteThroughService)

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
			'getPullRequestWriteContext'
		).mockResolvedValue(repositoryAccessContext)
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

	test.each([
		false,
		true,
	])('clears reconciled GitHub stats only when comparisonChanged is %s', async comparisonChanged => {
		vi.spyOn(repository, 'reconcileGitHubPullRequest').mockResolvedValue({
			id: pullRequestId,
			comparisonChanged,
		})

		await service.reconcileGitHubPullRequests({
			actorIds: new Map([[gitHubPullRequest.author.nodeId, gitHubActorId]]),
			pendingEvents: [],
			pullRequests: [gitHubPullRequest],
			repositoryId,
		})

		expect(repository.clearDiffStats).toHaveBeenCalledTimes(
			comparisonChanged ? 1 : 0
		)
		if (comparisonChanged)
			expect(repository.clearDiffStats).toHaveBeenCalledWith(pullRequestId)
	})

	test('stores the diff totals GitHub reported instead of clearing them', async () => {
		vi.spyOn(repository, 'reconcileGitHubPullRequest').mockResolvedValue({
			id: pullRequestId,
			comparisonChanged: true,
		})

		await service.reconcileGitHubPullRequests({
			actorIds: new Map([[gitHubPullRequest.author.nodeId, gitHubActorId]]),
			pendingEvents: [],
			pullRequests: [
				{
					...gitHubPullRequest,
					additions: 12,
					deletions: 4,
					changedFiles: 2,
				},
			],
			repositoryId,
		})

		expect(repository.writeDiffStats).toHaveBeenCalledWith({
			pullRequestId,
			baseSha: gitHubPullRequest.baseSha,
			headSha: gitHubPullRequest.headSha,
			additions: 12,
			deletions: 4,
			changedFiles: 2,
			computedAt: expect.any(Date),
		})
		expect(repository.clearDiffStats).not.toHaveBeenCalled()
	})

	test('computes, caches, and returns diff stats when creating', async () => {
		vi.spyOn(repository, 'create').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			...canonicalComparison,
			headSha: 'head-sha',
			mergeBaseSha: 'merge-base-sha',
			files: [
				{
					status: 'modified',
					oldPath: 'src/index.ts',
					newPath: 'src/index.ts',
					baseBlobId: 'base-blob',
					headBlobId: 'head-blob',
					additions: 12,
					deletions: 4,
					isBinary: false,
				},
			],
		})
		const writeDiffStatsSpy = vi.spyOn(repository, 'writeDiffStats')

		expect(
			await service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
				body: undefined,
			})
		).toMatchObject({
			diffStats: { additions: 12, deletions: 4, changedFiles: 1 },
		})
		expect(writeDiffStatsSpy).toHaveBeenCalledWith({
			pullRequestId,
			baseSha: 'merge-base-sha',
			headSha: 'head-sha',
			additions: 12,
			deletions: 4,
			changedFiles: 1,
			computedAt: expect.any(Date),
		})
	})

	test('returns no create stats and warns when comparison fails', async () => {
		vi.spyOn(repository, 'create').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockRejectedValue(
			new Error('comparison unavailable')
		)
		const warnSpy = vi.spyOn(service['logger'], 'warn')

		expect(
			await service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
				body: undefined,
			})
		).toMatchObject({ diffStats: undefined })
		expect(warnSpy).toHaveBeenCalledWith(
			`Diff stats for pull request ${pullRequestId} could not be computed`,
			expect.any(Error)
		)
		expect(repository.writeDiffStats).not.toHaveBeenCalled()
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
		expect(gitHubWriteThroughService.updatePullRequest).not.toHaveBeenCalled()
	})

	test('dispatches mirrored lifecycle writes with the GitHub context and bypasses native repositories', async () => {
		vi.spyOn(
			repositoriesService,
			'getPullRequestWriteContext'
		).mockResolvedValue({
			...repositoryAccessContext,
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		const closedPullRequest = {
			...pullRequest,
			state: 'closed' as const,
			closedAt: createdAt,
		}
		vi.spyOn(repository, 'find')
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValueOnce({ ...pullRequest, title: 'Updated' })
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValueOnce({ ...pullRequest, targetBranch: 'release' })
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValueOnce(closedPullRequest)
			.mockResolvedValueOnce(closedPullRequest)
			.mockResolvedValueOnce(pullRequest)
		vi.spyOn(gitHubWriteThroughService, 'updatePullRequest').mockResolvedValue()

		await service.edit(mockUserId, {
			...repositoryInput,
			number: 1,
			title: 'Updated',
			body: 'Body',
		})
		await service.retarget(mockUserId, {
			...repositoryInput,
			number: 1,
			targetBranch: 'release',
		})
		await service.close(mockUserId, { ...repositoryInput, number: 1 })
		await service.reopen(mockUserId, { ...repositoryInput, number: 1 })

		const writeThrough = {
			actorUserId: mockUserId,
			externalRepository: { ownerLogin: 'tessera-org', name: 'notes' },
			pullRequestId,
			repositoryId,
		}
		expect(
			vi.mocked(gitHubWriteThroughService.updatePullRequest).mock.calls
		).toEqual([
			[
				writeThrough,
				{
					title: 'Updated',
					body: 'Body',
					state: undefined,
					targetBranch: undefined,
				},
			],
			[
				writeThrough,
				{
					title: undefined,
					body: undefined,
					state: undefined,
					targetBranch: 'release',
				},
			],
			[
				writeThrough,
				{
					title: undefined,
					body: undefined,
					state: 'closed',
					targetBranch: undefined,
				},
			],
			[
				writeThrough,
				{
					title: undefined,
					body: undefined,
					state: 'open',
					targetBranch: undefined,
				},
			],
		])
		expect(repository.edit).not.toHaveBeenCalled()
		expect(repository.retarget).not.toHaveBeenCalled()
		expect(repository.close).not.toHaveBeenCalled()
		expect(repository.reopen).not.toHaveBeenCalled()
		expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
		expect(
			mergeQueueRepository.acquireRepositoryMergeLease
		).not.toHaveBeenCalled()
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

	// Only the target moves. The source is what the pull request is, and every
	// review, check and thread on it was made about that history.
	describe('retargeting a pull request', () => {
		const retargetInput = {
			...repositoryInput,
			number: 1,
			targetBranch: 'release',
		}
		const retargeted = { ...pullRequest, targetBranch: 'release' }

		beforeEach(() => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue(
				undefined
			)
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
					{
						type: 'branch',
						name: 'release',
						qualifiedName: 'refs/heads/release',
						target: 'release-sha',
					},
				],
				tags: [],
			})
		})

		test('moves the target against the one it validated', async () => {
			const retargetSpy = vi
				.spyOn(repository, 'retarget')
				.mockResolvedValue({ status: 'retargeted', pullRequest: retargeted })

			expect(await service.retarget(mockUserId, retargetInput)).toEqual(
				expect.objectContaining({ targetBranch: 'release' })
			)
			expect(retargetSpy).toHaveBeenCalledWith({
				repositoryId,
				pullRequestId,
				actorUserId: mockUserId,
				expectedTargetBranch: 'main',
				leaseOwner: expect.any(String),
				targetBranch: 'release',
			})
			expect(
				mergeQueueRepository.releaseRepositoryMergeLease
			).toHaveBeenCalled()
		})

		test('clears stale stats before computing and returning the retargeted pair', async () => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'retargeted',
				pullRequest: retargeted,
			})
			const clearDiffStatsSpy = vi.spyOn(repository, 'clearDiffStats')
			const compareSpy = vi
				.spyOn(gitStorageClient, 'compareRepositoryRefs')
				.mockResolvedValue({
					...canonicalComparison,
					headSha: 'head-sha',
					mergeBaseSha: 'release-merge-base',
					files: [
						{
							status: 'modified',
							oldPath: 'src/index.ts',
							newPath: 'src/index.ts',
							baseBlobId: 'base-blob',
							headBlobId: 'head-blob',
							additions: 5,
							deletions: 2,
							isBinary: false,
						},
					],
				})

			expect(await service.retarget(mockUserId, retargetInput)).toMatchObject({
				targetBranch: 'release',
				diffStats: { additions: 5, deletions: 2, changedFiles: 1 },
			})
			expect(clearDiffStatsSpy).toHaveBeenCalledWith(pullRequestId)
			expect(compareSpy).toHaveBeenCalledWith({
				...repositoryContext,
				baseRef: 'release',
				headRef: 'feature',
			})
			expect(clearDiffStatsSpy.mock.invocationCallOrder[0]).toBeLessThan(
				compareSpy.mock.invocationCallOrder[0] ?? 0
			)
		})

		// The write is fenced on the same lease the service took, so the transaction
		// can prove the hold still exists rather than trusting that it once did.
		test('hands the lease it acquired to the write that is fenced on it', async () => {
			const retargetSpy = vi
				.spyOn(repository, 'retarget')
				.mockResolvedValue({ status: 'retargeted', pullRequest: retargeted })

			await service.retarget(mockUserId, retargetInput)

			const [acquired] =
				vi
					.mocked(mergeQueueRepository.acquireRepositoryMergeLease)
					.mock.calls.at(-1) ?? []
			const [written] = retargetSpy.mock.calls.at(-1) ?? []

			expect(written?.leaseOwner).toBe(acquired?.owner)
		})

		// An identical request committed first, so the state this one asked for
		// holds. A retry must not be failed for having succeeded.
		test('reports a target already moved where it asked as a success', async () => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'unchanged',
				pullRequest: retargeted,
			})

			expect(await service.retarget(mockUserId, retargetInput)).toEqual(
				expect.objectContaining({ targetBranch: 'release' })
			)
		})

		test('refuses once the repository merge lease has been lost', async () => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'lease_lost',
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(RepositoryMergeInProgressError)
		})

		// Asking for the target it already has changes nothing, so nothing is
		// written and no timeline entry claims the branch moved.
		test('writes nothing when the target is already the one asked for', async () => {
			const retargetSpy = vi.spyOn(repository, 'retarget')

			expect(
				await service.retarget(mockUserId, {
					...retargetInput,
					targetBranch: 'main',
				})
			).toEqual(expect.objectContaining({ targetBranch: 'main' }))
			expect(retargetSpy).not.toHaveBeenCalled()
			expect(
				mergeQueueRepository.acquireRepositoryMergeLease
			).not.toHaveBeenCalled()
		})

		test('rejects a target branch that does not exist', async () => {
			await expect(
				service.retarget(mockUserId, {
					...retargetInput,
					targetBranch: 'missing',
				})
			).rejects.toBeInstanceOf(PullRequestInvalidBranchesError)
		})

		test('rejects targeting the pull request’s own source branch', async () => {
			await expect(
				service.retarget(mockUserId, {
					...retargetInput,
					targetBranch: 'feature',
				})
			).rejects.toBeInstanceOf(PullRequestInvalidBranchesError)
		})

		test('rejects a target resolving to the source revision', async () => {
			vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
				branches: [
					{
						type: 'branch',
						name: 'feature',
						qualifiedName: 'refs/heads/feature',
						target: 'same',
					},
					{
						type: 'branch',
						name: 'release',
						qualifiedName: 'refs/heads/release',
						target: 'same',
					},
				],
				tags: [],
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestNoChangesError)
		})

		test.each([
			'closed',
			'merged',
		] as const)('refuses to retarget a %s pull request', async state => {
			vi.spyOn(repository, 'find').mockResolvedValue({
				...pullRequest,
				state,
				closedAt: createdAt,
			})
			const retargetSpy = vi.spyOn(repository, 'retarget')

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestStateConflictError)
			expect(retargetSpy).not.toHaveBeenCalled()
		})

		test('maps open branch pair uniqueness to a conflict', async () => {
			vi.spyOn(repository, 'retarget').mockRejectedValue({
				code: '23505',
				constraint: 'pull_requests_open_branch_pair_unique',
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestAlreadyOpenError)
			expect(
				mergeQueueRepository.releaseRepositoryMergeLease
			).toHaveBeenCalled()
		})

		// Somebody is merging this repository right now, against the target this
		// would move out from under them.
		test('refuses while another merge holds the repository', async () => {
			vi.spyOn(
				mergeQueueRepository,
				'acquireRepositoryMergeLease'
			).mockResolvedValue(false)
			const retargetSpy = vi.spyOn(repository, 'retarget')

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(RepositoryMergeInProgressError)
			expect(retargetSpy).not.toHaveBeenCalled()
		})

		test('refuses when an intent is still held under the row lock', async () => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'merge_in_progress',
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestMergeInProgressError)
		})

		// Blocked rather than removed: the entry says what its author queued. What
		// they can do about it depends on the state — a `merging` entry cannot be
		// taken back out, so it must not be answered with "leave the queue".
		test.each([
			['queued', 'Leave the merge queue before changing the target branch.'],
			[
				'merging',
				'This pull request is being merged right now. Change the target once that merge has settled.',
			],
		] as const)('refuses a %s pull request with an actionable message', async (queueState, message) => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'queued',
				queueState,
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestQueuedError)
			await expect(service.retarget(mockUserId, retargetInput)).rejects.toThrow(
				message
			)
		})

		test('refuses a move the pull request state no longer allows', async () => {
			vi.spyOn(repository, 'retarget').mockResolvedValue({
				status: 'pull_request_unavailable',
			})

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestStateConflictError)
		})

		// An abandoned attempt already merged this pull request onto the target
		// being moved away from, and only recovery could say so.
		test('records an abandoned merge and refuses the move', async () => {
			vi.spyOn(repository, 'find').mockResolvedValue({
				...pullRequest,
				authorUsername: 'marta',
			})
			vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue({
				actor: { id: mockUserId, name: 'Grace', email: 'grace@example.com' },
				attemptId: '00000000-0000-4000-8000-000000000099',
				request: {
					strategy: 'squash',
					expectedBaseSha: 'c'.repeat(40),
					expectedHeadSha: 'd'.repeat(40),
					squashTitle: 'The abandoned title',
					squashBody: '',
				},
				startedAt: createdAt,
			})
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
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
			const retargetSpy = vi.spyOn(repository, 'retarget')

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toBeInstanceOf(PullRequestStateConflictError)
			expect(repository.completeMerge).toHaveBeenCalledWith(
				expect.objectContaining({ resultingSha: 'merge-sha' })
			)
			expect(retargetSpy).not.toHaveBeenCalled()
		})

		// Authority is enforced at the repository context, so a repository GitHub
		// took over is refused before a single ref is read.
		test('refuses on a repository GitHub is the source of truth for', async () => {
			vi.spyOn(
				repositoriesService,
				'getPullRequestWriteContext'
			).mockRejectedValue(new Error('github is the source of truth'))
			const retargetSpy = vi.spyOn(repository, 'retarget')

			await expect(
				service.retarget(mockUserId, retargetInput)
			).rejects.toThrow()
			expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
			expect(retargetSpy).not.toHaveBeenCalled()
		})
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

	test('skips comparison repair when the cached pair already matches', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			diffStatsBaseSha: canonicalComparison.mergeBaseSha,
			diffStatsHeadSha: canonicalComparison.headSha,
		})
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue(
			canonicalComparison
		)

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(repository.writeDiffStats).not.toHaveBeenCalled()
	})

	// Synchronized stats are dated by the mapped base, which the merge base only
	// equals when the target branch has not moved since.
	test('keeps synchronized stats dated by the mapped GitHub base', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			diffStatsBaseSha: 'github-base-sha',
			diffStatsHeadSha: canonicalComparison.headSha,
			github: {
				nodeId: 'github-pull-request-node',
				htmlUrl: 'https://github.com/marta/notes/pull/77',
				draft: false,
				headSha: canonicalComparison.headSha,
				baseSha: 'github-base-sha',
			},
		})
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue(
			canonicalComparison
		)

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(repository.writeDiffStats).not.toHaveBeenCalled()
	})

	test('repairs comparison stats when the cached pair differs', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			...canonicalComparison,
			files: [
				{
					status: 'modified',
					oldPath: 'src/index.ts',
					newPath: 'src/index.ts',
					baseBlobId: 'base-blob',
					headBlobId: 'head-blob',
					additions: 9,
					deletions: 3,
					isBinary: false,
				},
			],
		})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(repository.writeDiffStats).toHaveBeenCalledWith({
			pullRequestId,
			baseSha: canonicalComparison.mergeBaseSha,
			headSha: canonicalComparison.headSha,
			additions: 9,
			deletions: 3,
			changedFiles: 1,
			computedAt: expect.any(Date),
		})
	})

	test('clears stale stats instead of caching a truncated comparison', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			diffStatsBaseSha: 'old-base',
			diffStatsHeadSha: 'old-head',
			diffAdditions: 20,
			diffDeletions: 5,
			diffChangedFiles: 3,
			diffStatsUpdatedAt: createdAt,
		})
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			...canonicalComparison,
			isTruncated: true,
		})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(repository.clearDiffStats).toHaveBeenCalledWith(pullRequestId)
		expect(repository.writeDiffStats).not.toHaveBeenCalled()
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
		expect(repository.writeDiffStats).toHaveBeenCalledWith({
			pullRequestId,
			baseSha: canonicalComparison.mergeBaseSha,
			headSha: canonicalComparison.headSha,
			additions: 0,
			deletions: 0,
			changedFiles: 0,
			computedAt: expect.any(Date),
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

	describe('expanding context lines', () => {
		const fileLinesInput = {
			...repositoryInput,
			number: 1,
			path: 'src/index.ts',
			side: 'right' as const,
			startLine: 1,
			endLine: 2,
			expectedBaseSha: 'a'.repeat(40),
			expectedHeadSha: 'b'.repeat(40),
		}
		const expandableDiff = {
			baseSha: 'a'.repeat(40),
			headSha: 'b'.repeat(40),
			mergeBaseSha: 'a'.repeat(40),
			file: {
				status: 'modified' as const,
				oldPath: 'src/index.ts',
				newPath: 'src/index.ts',
				baseBlobId: 'base-blob',
				headBlobId: 'head-blob',
				additions: 1,
				deletions: 0,
				isBinary: false,
			},
			hunks: [],
			isTruncated: false,
			patchLimitBytes: 2_097_152,
		}

		test('slices the head blob into context lines anchored on the requested side', async () => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockResolvedValue(
				expandableDiff
			)
			const blobSpy = vi
				.spyOn(gitStorageClient, 'getRepositoryBlob')
				.mockResolvedValue({
					objectId: 'head-blob',
					sizeBytes: 28,
					preview: { type: 'text', content: 'const a = 1\nconst b = 2\n' },
				})

			await expect(
				service.fileLines(undefined, fileLinesInput)
			).resolves.toMatchObject({
				totalLines: 2,
				lines: [
					{ kind: 'context', content: 'const a = 1' },
					{
						kind: 'context',
						new: { line: 2, path: 'src/index.ts', sha: 'b'.repeat(40) },
					},
				],
			})
			expect(blobSpy).toHaveBeenCalledWith({
				...repositoryContext,
				objectId: 'head-blob',
			})
		})

		test('reports commits git storage no longer holds as a stale comparison', async () => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockRejectedValue(
				new ExternalServiceError('git storage', {
					grpcCode: status.NOT_FOUND,
				})
			)

			await expect(
				service.fileLines(undefined, fileLinesInput)
			).rejects.toBeInstanceOf(PullRequestStaleComparisonError)
		})

		test('refuses to expand a side with no readable text', async () => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(gitStorageClient, 'getRepositoryFileDiff').mockResolvedValue(
				expandableDiff
			)
			vi.spyOn(gitStorageClient, 'getRepositoryBlob').mockResolvedValue({
				objectId: 'head-blob',
				sizeBytes: 2_097_152,
				preview: { type: 'tooLarge', previewLimitBytes: 1_048_576 },
			})

			await expect(
				service.fileLines(undefined, fileLinesInput)
			).rejects.toBeInstanceOf(PullRequestFileContentNotFoundError)
		})
	})

	// An abandoned attempt may already have moved the target, and a fresh
	// evaluation would read that as staleness and refuse this attempt. So the
	// operation's receipt is read first: it says whether git storage actually
	// performed the merge, which is the only thing that may be recorded after the
	// fact.
	describe('recovering an abandoned merge', () => {
		const abandoned = {
			actor: { id: mockUserId, name: 'Grace', email: 'grace@example.com' },
			attemptId: '00000000-0000-4000-8000-000000000099',
			request: {
				strategy: 'squash' as const,
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
				squashTitle: 'The abandoned title',
				squashBody: '',
			},
			startedAt: new Date('2026-07-11T00:00:00Z'),
		}

		beforeEach(() => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
			vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
			vi.spyOn(repository, 'completeMerge').mockResolvedValue({
				...pullRequest,
				state: 'merged',
				mergeCommitSha: 'merge-sha',
				mergeActorUserId: mockUserId,
				mergedAt: createdAt,
				closedAt: createdAt,
			})
			vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue(
				abandoned
			)
			vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
				'merge-sha'
			)
		})

		test('records a merge git storage had already made', async () => {
			const findReceipt = vi
				.spyOn(gitStorageClient, 'findMergeReceipt')
				.mockResolvedValue('merge-sha')
			const evaluateSpy = vi.spyOn(mergeRequirementsService, 'evaluate')

			expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
				status: 'merged',
			})
			expect(findReceipt).toHaveBeenCalledWith(
				expect.objectContaining({
					operationId: pullRequestId,
					strategy: 'squash',
					expectedBaseSha: 'c'.repeat(40),
					expectedHeadSha: 'd'.repeat(40),
				})
			)
			// Nothing was judged and nothing was merged: the merge already existed.
			expect(evaluateSpy).not.toHaveBeenCalled()
			expect(gitStorageClient.mergeRepositoryRefs).not.toHaveBeenCalled()
			expect(repository.completeMerge).toHaveBeenCalledWith(
				expect.objectContaining({
					attemptId: abandoned.attemptId,
					actorUserId: abandoned.actor.id,
					resultingSha: 'merge-sha',
				})
			)
		})

		// The attempt died before git storage ever performed the merge. Replaying
		// it would merge on the strength of an evaluation nobody repeated, under an
		// actor and a waiver it inherited.
		test('never merges an intent git storage has no receipt for', async () => {
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
				undefined
			)
			const evaluateSpy = vi
				.spyOn(mergeRequirementsService, 'evaluate')
				.mockResolvedValue(blockedRequirements)
			vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()

			expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
				status: 'blocked',
			})
			expect(repository.releaseMerge).toHaveBeenCalledWith(
				expect.objectContaining({ attemptId: abandoned.attemptId })
			)
			expect(repository.completeMerge).not.toHaveBeenCalled()
			// The merge is decided again from scratch, like any other.
			expect(evaluateSpy).toHaveBeenCalled()
		})

		// A repository GitHub has taken over is no longer Tessera's to record
		// merges on.
		test('leaves a mirrored repository alone', async () => {
			vi.spyOn(
				repositoriesService,
				'getReadableRepositoryContext'
			).mockResolvedValue({
				...repositoryAccessContext,
				tesseraWritesAllowed: false,
				gitHubTarget: { ownerLogin: 'octo', name: 'notes' },
			})
			const findReceipt = vi.spyOn(gitStorageClient, 'findMergeReceipt')

			await service.merge(mergeActor, mergeInput)

			expect(findReceipt).not.toHaveBeenCalled()
			expect(repository.completeMerge).not.toHaveBeenCalled()
		})

		test('evaluates normally when no intent was abandoned', async () => {
			vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue(
				undefined
			)
			const findReceipt = vi.spyOn(gitStorageClient, 'findMergeReceipt')
			const evaluateSpy = vi
				.spyOn(mergeRequirementsService, 'evaluate')
				.mockResolvedValue(eligibleRequirements)

			await service.merge(mergeActor, mergeInput)

			expect(findReceipt).not.toHaveBeenCalled()
			expect(evaluateSpy).toHaveBeenCalled()
		})
	})

	// An intent that recorded its request is only ever resolved by recovery. It
	// can age past the recovery cutoff in the moment between recovery looking and
	// the claim arriving, and overwriting it there would destroy the evidence of
	// a merge git storage had already made.
	test('never claims past an intent that recorded its request', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue(
			undefined
		)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			eligibleRequirements
		)
		// The claim finds what recovery did not: an intent that crossed the cutoff
		// while the requirements were being evaluated.
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(undefined)
		vi.spyOn(repository, 'findById').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()
		const mergeGitSpy = vi.spyOn(gitStorageClient, 'mergeRepositoryRefs')

		expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
			status: 'blocked',
		})
		expect(mergeGitSpy).not.toHaveBeenCalled()
	})

	// Closing deletes the intent, and the intent is the only record of which
	// merge an abandoned attempt was making.
	describe('closing a pull request with an abandoned merge', () => {
		const abandoned = {
			actor: { id: mockUserId, name: 'Grace', email: 'grace@example.com' },
			attemptId: '00000000-0000-4000-8000-000000000099',
			request: {
				strategy: 'squash' as const,
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
				squashTitle: 'The abandoned title',
				squashBody: '',
			},
			startedAt: new Date('2026-07-11T00:00:00Z'),
		}

		beforeEach(() => {
			vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
			vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
			vi.spyOn(
				mergeQueueRepository,
				'acquireRepositoryMergeLease'
			).mockResolvedValue(true)
			vi.spyOn(
				mergeQueueRepository,
				'releaseRepositoryMergeLease'
			).mockResolvedValue(undefined)
			vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue(
				abandoned
			)
		})

		// The pull request was merged, whatever the person clicking believed.
		test('records the merge and refuses the close', async () => {
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
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
			const closeSpy = vi.spyOn(repository, 'close')

			await expect(
				service.close(mockUserId, { ...repositoryInput, number: 1 })
			).rejects.toThrow()
			expect(repository.completeMerge).toHaveBeenCalledWith(
				expect.objectContaining({ resultingSha: 'merge-sha' })
			)
			expect(closeSpy).not.toHaveBeenCalled()
		})

		test('releases an intent nothing merged and closes', async () => {
			vi.spyOn(gitStorageClient, 'findMergeReceipt').mockResolvedValue(
				undefined
			)
			vi.spyOn(repository, 'completeMerge').mockResolvedValue(undefined)
			vi.spyOn(repository, 'close').mockResolvedValue({
				...pullRequest,
				state: 'closed',
				closedAt: createdAt,
			})

			expect(
				await service.close(mockUserId, { ...repositoryInput, number: 1 })
			).toMatchObject({ state: 'closed' })
			expect(repository.releaseMerge).toHaveBeenCalledWith(
				expect.objectContaining({ attemptId: abandoned.attemptId })
			)
		})

		// Somebody is merging this repository right now; their attempt owns the
		// intent and the close does not race it.
		test('refuses while another merge holds the repository', async () => {
			vi.spyOn(
				mergeQueueRepository,
				'acquireRepositoryMergeLease'
			).mockResolvedValue(false)
			const closeSpy = vi.spyOn(repository, 'close')

			await expect(
				service.close(mockUserId, { ...repositoryInput, number: 1 })
			).rejects.toThrow()
			expect(closeSpy).not.toHaveBeenCalled()
		})
	})

	// The strategies migration left old intents in place rather than requiring a
	// quiesce. They recorded no request, so they cannot be looked up or replayed.
	test('releases a migrated intent that recorded no request', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'releaseMerge').mockResolvedValue()
		vi.spyOn(repository, 'findRecoverableMergeIntent').mockResolvedValue({
			actor: { id: mockUserId, name: 'Grace', email: 'grace@example.com' },
			attemptId: '00000000-0000-4000-8000-000000000099',
			startedAt: new Date('2026-07-11T00:00:00Z'),
		})
		const findReceipt = vi.spyOn(gitStorageClient, 'findMergeReceipt')
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
		vi.spyOn(mergeRequirementsService, 'evaluate').mockResolvedValue(
			blockedRequirements
		)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()

		await service.merge(mergeActor, mergeInput)

		// Nothing to look up, so nothing is asked; the intent is handed back and
		// the merge is judged from scratch.
		expect(findReceipt).not.toHaveBeenCalled()
		expect(repository.releaseMerge).toHaveBeenCalledWith(
			expect.objectContaining({
				attemptId: '00000000-0000-4000-8000-000000000099',
			})
		)
	})

	// The strategy the caller chose is what the evaluation judges and what Git is
	// asked for; nothing in between may substitute another.
	test.each([
		'merge_commit',
		'squash',
		'rebase',
		'fast_forward',
	] as const)('merges by the %s the caller chose', async strategy => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		const evaluateSpy = vi
			.spyOn(mergeRequirementsService, 'evaluate')
			.mockResolvedValue(eligibleRequirements)
		const mergeGitSpy = vi
			.spyOn(gitStorageClient, 'mergeRepositoryRefs')
			.mockResolvedValue('merge-sha')

		await service.merge(mergeActor, { ...mergeInput, strategy })

		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({ strategy })
		)
		expect(mergeGitSpy).toHaveBeenCalledWith(
			expect.objectContaining({ strategy })
		)
		expect(gitHubWriteThroughService.mergePullRequest).not.toHaveBeenCalled()
	})

	test('claims the merge before Git and completes persistence afterward', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const claimMergeSpy = vi
			.spyOn(repository, 'claimMerge')
			.mockImplementation(claimMerge)
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
				mergeInput
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
				resultingSha: 'merge-sha',
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue(undefined)

		expect(
			await service.merge(
				{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
				mergeInput
			)
		).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: 'merge-sha' },
		})
	})

	test('releases the merge intent after a deterministic stale-ref failure', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
		vi.spyOn(repository, 'recordMergeBlocked').mockResolvedValue()
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.ABORTED })
		)
		const releaseMergeSpy = vi
			.spyOn(repository, 'releaseMerge')
			.mockResolvedValue()

		await service.merge(
			{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
			mergeInput
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.UNAVAILABLE,
			})
		)

		await expect(service.merge(mergeActor, mergeInput)).rejects.toThrow()
	})

	test('merges the refs the evaluation resolved, not the ones the caller sent', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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
			.mockImplementation(claimMerge)
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
			gitHubTarget: { ownerLogin: 'octo', name: 'notes' },
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
				reasonCodes: ['insufficient_permission'],
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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
		vi.spyOn(repository, 'claimMerge').mockImplementation(claimMerge)
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

	test('returns GitHub merge requirements without native evaluation', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			...repositoryAccessContext,
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			github: {
				nodeId: 'pull-request-node',
				htmlUrl: 'https://github.com/tessera-org/notes/pull/1',
				draft: false,
				headSha: 'github-head',
				baseSha: 'github-base',
			},
		})

		expect(
			await service.getMergeRequirements(mockUserId, {
				...repositoryInput,
				number: 1,
			})
		).toEqual({
			eligible: true,
			canBypass: false,
			reasons: [],
			evaluatedBaseSha: 'github-base',
			evaluatedHeadSha: 'github-head',
		})
		expect(mergeRequirementsService.evaluate).not.toHaveBeenCalled()
	})

	test('merges a mirrored pull request without requirements, queue, Rust, or native merge writes', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			...repositoryAccessContext,
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(repository, 'find')
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValueOnce({
				...pullRequest,
				state: 'merged',
				mergeCommitSha: 'github-merge-sha',
				closedAt: createdAt,
				mergedAt: createdAt,
			})
		vi.spyOn(gitHubWriteThroughService, 'mergePullRequest').mockResolvedValue()

		expect(await service.merge(mergeActor, mergeInput)).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: 'github-merge-sha' },
		})
		expect(gitHubWriteThroughService.mergePullRequest).toHaveBeenCalledWith(
			{
				actorUserId: mockUserId,
				externalRepository: {
					ownerLogin: 'tessera-org',
					name: 'notes',
				},
				pullRequestId,
				repositoryId,
			},
			{
				expectedHeadSha: 'b'.repeat(40),
				strategy: 'merge_commit',
			}
		)
		expect(mergeRequirementsService.evaluate).not.toHaveBeenCalled()
		expect(
			mergeQueueRepository.acquireRepositoryMergeLease
		).not.toHaveBeenCalled()
		expect(gitStorageClient.mergeRepositoryRefs).not.toHaveBeenCalled()
		expect(repository.claimMerge).not.toHaveBeenCalled()
		expect(repository.completeMerge).not.toHaveBeenCalled()
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
				missingRequiredContexts: [],
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
			requiredContexts: undefined,
		})
	})

	test('keeps the checks answer current when the caller named the live head', async () => {
		const checksReadService = moduleRef.get(ChecksReadService)
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const listChecksSpy = vi
			.spyOn(checksReadService, 'listChecks')
			.mockResolvedValue({
				checks: [],
				missingRequiredContexts: [],
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
			requiredContexts: undefined,
		})
	})
})
