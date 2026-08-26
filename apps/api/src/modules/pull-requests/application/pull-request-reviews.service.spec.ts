import { GitStorageClient } from '@config/git-storage'
import { GitHubWriteThroughService } from '@modules/github-write-through'
import { RepositoriesService } from '@modules/repositories'
import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import { PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE } from '@repo/contracts'
import type {
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { ForbiddenError, NotFoundError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import { PullRequestStateConflictError } from '../domain/pull-request.errors'
import {
	PullRequestPendingReviewConflictError,
	PullRequestReviewAuthorForbiddenError,
	PullRequestReviewerAlreadyRequestedError,
	PullRequestReviewerIneligibleError,
	PullRequestReviewerRequestForbiddenError,
} from '../domain/pull-request-review.errors'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { PullRequestHeadResolver } from './pull-request-head.resolver'
import { PullRequestReviewsService } from './pull-request-reviews.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const reviewerUserId = '00000000-0000-4000-8000-000000000055' as UserId
const strangerUserId = '00000000-0000-4000-8000-000000000066' as UserId
const reviewId = '00000000-0000-4000-8000-000000000077' as PullRequestReviewId
const requestId =
	'00000000-0000-4000-8000-000000000088' as PullRequestReviewerRequestId
const createdAt = new Date('2026-08-08T10:00:00Z')
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}
const pullRequest: PullRequestReadModel = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'opening-head',
	title: 'Feature',
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
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
	github: undefined,
}
const unknownActor = {
	userId: null,
	username: null,
	displayName: null,
	imageUrl: null,
	externalNodeId: null,
	externalLogin: null,
	externalAvatarUrl: null,
	externalHtmlUrl: null,
}

function nativeActor(userId: UserId, username: string) {
	return { ...unknownActor, userId, username }
}

function currentHeadRefs(sha: string) {
	return new Map([[pullRequestId, { sha, isCurrent: true }]])
}

const submittedReview = {
	id: reviewId,
	reviewer: nativeActor(reviewerUserId, 'reviewer'),
	state: 'submitted' as const,
	outcome: 'approve' as const,
	body: '',
	headSha: 'reviewed-head',
	submittedAt: createdAt,
	dismissedAt: null,
	dismissedBy: unknownActor,
	sourceUrl: null,
}
const reviewerRequest = {
	id: requestId,
	targetKind: 'user' as const,
	reviewer: nativeActor(reviewerUserId, 'reviewer'),
	requestedBy: nativeActor(mockUserId, 'marta'),
	createdAt,
}

describe(PullRequestReviewsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestReviewsService
	let reviewsRepository: PullRequestReviewsRepository
	let pullRequestsRepository: PullRequestsRepository
	let repositoriesService: RepositoriesService
	let userService: UserService
	let gitStorageClient: GitStorageClient
	let gitHubWriteThroughService: GitHubWriteThroughService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestReviewsService,
				PullRequestHeadResolver,
				{
					provide: PullRequestReviewsRepository,
					useValue: {
						createReviewerRequest: vi.fn(),
						removeReviewerRequest: vi.fn(),
						submitReview: vi.fn(),
						discardPendingReview: vi.fn(),
						findReview: vi.fn(),
						findReviewerRequest: vi.fn(),
						listActiveReviewerRequests: vi.fn().mockResolvedValue([]),
						listReviewHistory: vi.fn().mockResolvedValue([]),
						findPendingReview: vi.fn(),
						listPendingReviewDrafts: vi.fn().mockResolvedValue([]),
						listEffectiveReviews: vi.fn().mockResolvedValue([]),
						countActiveReviewerRequests: vi.fn().mockResolvedValue([]),
					},
				},
				{ provide: PullRequestsRepository, useValue: { find: vi.fn() } },
				{
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
						canUserReadRepository: vi.fn(),
						listRepositoryPrincipals: vi.fn().mockResolvedValue([]),
					},
				},
				{ provide: UserService, useValue: { findUserId: vi.fn() } },
				{
					provide: GitStorageClient,
					useValue: {
						compareRepositoryRefs: vi.fn(),
						listRepositoryRefs: vi.fn(),
					},
				},
				{
					provide: GitHubWriteThroughService,
					useValue: {
						requestReviewer: vi.fn(),
						removeReviewerRequest: vi.fn(),
						submitReview: vi.fn(),
					},
				},
			],
		}).compile()
		service = moduleRef.get(PullRequestReviewsService)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		userService = moduleRef.get(UserService)
		gitStorageClient = moduleRef.get(GitStorageClient)
		gitHubWriteThroughService = moduleRef.get(GitHubWriteThroughService)

		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'write',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(userService, 'findUserId').mockResolvedValue(reviewerUserId)
		vi.spyOn(repositoriesService, 'canUserReadRepository').mockResolvedValue(
			true
		)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test.each([
		[mockUserId, 'read'],
		[strangerUserId, 'write'],
	] as const)('allows author or write user to request and remove reviewers', async (viewerUserId, viewerRole) => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole,
			tesseraWritesAllowed: true,
		})
		const createSpy = vi
			.spyOn(reviewsRepository, 'createReviewerRequest')
			.mockResolvedValue({ status: 'created', request: reviewerRequest })
		const removeSpy = vi
			.spyOn(reviewsRepository, 'removeReviewerRequest')
			.mockResolvedValue(true)

		await service.requestReviewer(viewerUserId, {
			...repositoryInput,
			reviewerUsername: 'reviewer',
		})
		expect(
			await service.removeReviewerRequest(viewerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).toEqual({ removed: true })
		expect(createSpy).toHaveBeenCalledOnce()
		expect(removeSpy).toHaveBeenCalledOnce()
	})

	test('dispatches mirrored review writes and discards the local pending review', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'write',
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})
		vi.spyOn(gitHubWriteThroughService, 'requestReviewer').mockResolvedValue(
			requestId
		)
		vi.spyOn(
			gitHubWriteThroughService,
			'removeReviewerRequest'
		).mockResolvedValue(true)
		vi.spyOn(gitHubWriteThroughService, 'submitReview').mockResolvedValue(
			reviewId
		)
		vi.spyOn(reviewsRepository, 'findReviewerRequest').mockResolvedValue(
			reviewerRequest
		)
		vi.spyOn(reviewsRepository, 'findReview').mockResolvedValue(submittedReview)

		expect(
			await service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).toStrictEqual({
			id: requestId,
			targetKind: 'user',
			reviewer: {
				key: reviewerUserId,
				provider: 'tessera',
				userId: reviewerUserId,
				username: 'reviewer',
				displayName: undefined,
				avatarUrl: undefined,
			},
			requestedBy: {
				key: mockUserId,
				provider: 'tessera',
				userId: mockUserId,
				username: 'marta',
				displayName: undefined,
				avatarUrl: undefined,
			},
			createdAt,
		})
		expect(
			await service.removeReviewerRequest(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).toEqual({ removed: true })
		expect(
			await service.submitReview(reviewerUserId, {
				...repositoryInput,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: 'expected-head',
			})
		).toStrictEqual({
			id: reviewId,
			reviewer: {
				key: reviewerUserId,
				provider: 'tessera',
				userId: reviewerUserId,
				username: 'reviewer',
				displayName: undefined,
				avatarUrl: undefined,
			},
			state: 'submitted',
			outcome: 'approve',
			body: '',
			headSha: 'reviewed-head',
			submittedAt: createdAt,
			dismissedAt: undefined,
			dismissedBy: undefined,
			sourceUrl: undefined,
		})
		vi.spyOn(reviewsRepository, 'discardPendingReview').mockResolvedValue(true)
		expect(
			await service.discardPendingReview(reviewerUserId, repositoryInput)
		).toEqual({ discarded: true })

		const ownerWriteThrough = {
			actorUserId: mockUserId,
			externalRepository: { ownerLogin: 'tessera-org', name: 'notes' },
			pullRequestId,
			repositoryId,
		}
		expect(gitHubWriteThroughService.requestReviewer).toHaveBeenCalledWith(
			ownerWriteThrough,
			{ reviewerUserId }
		)
		expect(
			gitHubWriteThroughService.removeReviewerRequest
		).toHaveBeenCalledWith(ownerWriteThrough, { reviewerUserId })
		expect(gitHubWriteThroughService.submitReview).toHaveBeenCalledWith(
			{ ...ownerWriteThrough, actorUserId: reviewerUserId },
			{
				body: '',
				drafts: [],
				expectedHeadSha: 'expected-head',
				outcome: 'approve',
				pendingCommentCount: 0,
				pendingReviewId: undefined,
			}
		)
		expect(reviewsRepository.findReviewerRequest).toHaveBeenCalledWith({
			requestId,
		})
		expect(reviewsRepository.findReview).toHaveBeenCalledWith({
			pullRequestId,
			reviewId,
		})
		expect(reviewsRepository.createReviewerRequest).not.toHaveBeenCalled()
		expect(reviewsRepository.removeReviewerRequest).not.toHaveBeenCalled()
		expect(reviewsRepository.submitReview).not.toHaveBeenCalled()
		expect(reviewsRepository.discardPendingReview).toHaveBeenCalledWith({
			pullRequestId,
			reviewerUserId,
		})
	})

	test('never touches write-through for a native review write', async () => {
		vi.spyOn(reviewsRepository, 'submitReview').mockResolvedValue({
			status: 'submitted',
			review: submittedReview,
		})

		await service.submitReview(reviewerUserId, {
			...repositoryInput,
			outcome: 'approve',
			body: undefined,
			expectedHeadSha: 'head-sha',
		})

		expect(gitHubWriteThroughService.submitReview).not.toHaveBeenCalled()
		expect(reviewsRepository.submitReview).toHaveBeenCalledOnce()
	})

	test('keeps reviewer capabilities on a mirrored pull request', async () => {
		expect(
			(
				await service.getReviewState({
					pullRequest: { ...pullRequest, provider: 'github' },
					repositoryId,
					storagePath: '/repositories/notes.git',
					viewerRole: 'read',
					viewerUserId: reviewerUserId,
				})
			).viewer
		).toEqual({
			allowedOutcomes: ['approve', 'request_changes', 'comment'],
			canRequestReviewers: false,
			canRemoveReviewerRequests: false,
		})
	})

	test('rejects read-only strangers requesting or removing reviewers', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})

		await expect(
			service.requestReviewer(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).rejects.toBeInstanceOf(PullRequestReviewerRequestForbiddenError)
		await expect(
			service.removeReviewerRequest(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).rejects.toBeInstanceOf(PullRequestReviewerRequestForbiddenError)
	})

	test('allows an authenticated reader who is not the author to submit', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		const submitSpy = vi
			.spyOn(reviewsRepository, 'submitReview')
			.mockResolvedValue({ status: 'submitted', review: submittedReview })

		await service.submitReview(reviewerUserId, {
			...repositoryInput,
			outcome: 'approve',
			body: undefined,
			expectedHeadSha: 'client-reviewed-head',
		})

		expect(submitSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				reviewerUserId,
				headSha: 'client-reviewed-head',
			})
		)
		expect(gitStorageClient.compareRepositoryRefs).not.toHaveBeenCalled()
	})

	test('submits against the pending review the reviewer already holds', async () => {
		vi.spyOn(reviewsRepository, 'findPendingReview').mockResolvedValue({
			id: reviewId,
			headSha: 'draft-head',
			commentCount: 3,
		})
		const submitSpy = vi
			.spyOn(reviewsRepository, 'submitReview')
			.mockResolvedValue({ status: 'submitted', review: submittedReview })

		await service.submitReview(reviewerUserId, {
			...repositoryInput,
			outcome: 'approve',
			body: undefined,
			expectedHeadSha: 'client-reviewed-head',
		})

		expect(submitSpy).toHaveBeenCalledWith(
			expect.objectContaining({ pendingReviewId: reviewId })
		)
	})

	test('reports a conflict when the pending review was submitted concurrently', async () => {
		vi.spyOn(reviewsRepository, 'findPendingReview').mockResolvedValue({
			id: reviewId,
			headSha: 'draft-head',
			commentCount: 1,
		})
		vi.spyOn(reviewsRepository, 'submitReview').mockResolvedValue({
			status: 'pending_review_conflict',
		})

		await expect(
			service.submitReview(reviewerUserId, {
				...repositoryInput,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: 'client-reviewed-head',
			})
		).rejects.toBeInstanceOf(PullRequestPendingReviewConflictError)
	})

	test.each([
		'approve',
		'request_changes',
	] as const)('rejects the pull request author submitting %s', async outcome => {
		await expect(
			service.submitReview(mockUserId, {
				...repositoryInput,
				outcome,
				body: undefined,
				expectedHeadSha: 'head',
			})
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof PullRequestReviewAuthorForbiddenError &&
				error.message === PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE &&
				error.context?.outcome === outcome
		)
		expect(reviewsRepository.submitReview).not.toHaveBeenCalled()
		expect(gitHubWriteThroughService.submitReview).not.toHaveBeenCalled()
	})

	test('allows the pull request author to comment', async () => {
		vi.spyOn(reviewsRepository, 'submitReview').mockResolvedValue({
			status: 'submitted',
			review: {
				...submittedReview,
				reviewer: nativeActor(mockUserId, 'marta'),
				outcome: 'comment',
			},
		})

		await service.submitReview(mockUserId, {
			...repositoryInput,
			outcome: 'comment',
			body: 'Author context',
			expectedHeadSha: 'head',
		})

		expect(reviewsRepository.submitReview).toHaveBeenCalledWith(
			expect.objectContaining({
				reviewerUserId: mockUserId,
				outcome: 'comment',
			})
		)
	})

	test.each([
		'approve',
		'request_changes',
	] as const)('rejects a GitHub-mapped author submitting %s before write-through', async outcome => {
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue({
			...pullRequest,
			provider: 'github',
			authorUserId: null,
			authorActorNodeId: 'github-author-node',
			authorActorUserId: mockUserId,
		})
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: false,
			gitHubTarget: { ownerLogin: 'tessera-org', name: 'notes' },
		})

		await expect(
			service.submitReview(mockUserId, {
				...repositoryInput,
				outcome,
				body: undefined,
				expectedHeadSha: 'head',
			})
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof PullRequestReviewAuthorForbiddenError &&
				error.message === PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE &&
				error.context?.outcome === outcome
		)
		expect(gitHubWriteThroughService.submitReview).not.toHaveBeenCalled()
	})

	test('allows the author to discard a pending review', async () => {
		vi.spyOn(reviewsRepository, 'discardPendingReview').mockResolvedValue(true)

		expect(
			await service.discardPendingReview(mockUserId, repositoryInput)
		).toEqual({ discarded: true })
		expect(reviewsRepository.discardPendingReview).toHaveBeenCalledWith({
			pullRequestId,
			reviewerUserId: mockUserId,
		})
	})

	test.each([
		'closed',
		'merged',
	] as const)('rejects all mutations on a %s pull request', async state => {
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue({
			...pullRequest,
			state,
			closedAt: createdAt,
			mergedAt: state === 'merged' ? createdAt : null,
			mergeCommitSha: state === 'merged' ? 'merge-sha' : null,
		})
		const mutations = [
			service.requestReviewer(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			}),
			service.removeReviewerRequest(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			}),
			service.submitReview(reviewerUserId, {
				...repositoryInput,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: 'head',
			}),
			service.discardPendingReview(reviewerUserId, repositoryInput),
		]

		for (const mutation of mutations)
			await expect(mutation).rejects.toBeInstanceOf(
				PullRequestStateConflictError
			)
	})

	test('rejects all mutations when GitHub is authoritative', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockRejectedValue(new ForbiddenError('repository'))
		const mutations = [
			service.requestReviewer(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			}),
			service.removeReviewerRequest(strangerUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			}),
			service.submitReview(reviewerUserId, {
				...repositoryInput,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: 'head',
			}),
			service.discardPendingReview(reviewerUserId, repositoryInput),
		]

		for (const mutation of mutations)
			await expect(mutation).rejects.toBeInstanceOf(ForbiddenError)
	})

	test('rejects unknown usernames', async () => {
		vi.spyOn(userService, 'findUserId').mockRejectedValue(
			new NotFoundError('user')
		)

		await expect(
			service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'missing',
			})
		).rejects.toBeInstanceOf(NotFoundError)
	})

	test('rejects a non-reader on a private repository', async () => {
		vi.spyOn(repositoriesService, 'canUserReadRepository').mockResolvedValue(
			false
		)

		await expect(
			service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).rejects.toBeInstanceOf(PullRequestReviewerIneligibleError)
	})

	test('rejects the author as reviewer', async () => {
		vi.spyOn(userService, 'findUserId').mockResolvedValue(mockUserId)

		await expect(
			service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'marta',
			})
		).rejects.toBeInstanceOf(PullRequestReviewerIneligibleError)
	})

	test('accepts a public repository reader resolved by exact username', async () => {
		const createSpy = vi
			.spyOn(reviewsRepository, 'createReviewerRequest')
			.mockResolvedValue({ status: 'created', request: reviewerRequest })

		await service.requestReviewer(mockUserId, {
			...repositoryInput,
			reviewerUsername: 'Reviewer.Exact',
		})

		expect(userService.findUserId).toHaveBeenCalledWith({
			username: 'Reviewer.Exact',
		})
		expect(createSpy).toHaveBeenCalledWith(
			expect.objectContaining({ reviewerUsername: 'Reviewer.Exact' })
		)
	})

	test('reports an already requested reviewer instead of a second request', async () => {
		vi.spyOn(reviewsRepository, 'createReviewerRequest').mockResolvedValue({
			status: 'already_requested',
		})

		await expect(
			service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).rejects.toBeInstanceOf(PullRequestReviewerAlreadyRequestedError)
	})

	test('reports a state conflict when the pull request closed under the request', async () => {
		vi.spyOn(reviewsRepository, 'createReviewerRequest').mockResolvedValue({
			status: 'pull_request_closed',
		})

		await expect(
			service.requestReviewer(mockUserId, {
				...repositoryInput,
				reviewerUsername: 'reviewer',
			})
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
	})

	/**
	 * A GitHub-synced review can outlive the account that wrote it. Until those
	 * reviewers are mapped, such a review is dropped everywhere rather than
	 * failing the whole detail view on an unrenderable row.
	 */
	test('leaves reviews without a resolvable reviewer out of the history and the effective states', async () => {
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000078' as PullRequestReviewId,
				reviewer: unknownActor,
			},
			submittedReview,
		])
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: 'base',
			headSha: 'reviewed-head',
			mergeBaseSha: 'base',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})

		const state = await service.getReviewState({
			pullRequest,
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
		})

		expect(state.reviews).toEqual([
			expect.objectContaining({
				id: reviewId,
				reviewer: expect.objectContaining({ username: 'reviewer' }),
			}),
		])
		expect(state.effectiveReviewStates).toEqual([
			expect.objectContaining({
				reviewId,
				reviewer: expect.objectContaining({ username: 'reviewer' }),
			}),
		])
	})

	test('leaves list reviews without a resolvable reviewer out of the summary counts', async () => {
		vi.spyOn(reviewsRepository, 'listEffectiveReviews').mockResolvedValue([
			{
				pullRequestId,
				reviewer: unknownActor,
				outcome: 'approve',
				headSha: 'reviewed-head',
			},
		])
		const summaries = await service.listReviewSummaries({
			headRefs: currentHeadRefs('reviewed-head'),
			pullRequests: [pullRequest],
		})

		expect(summaries.get(pullRequestId)).toEqual({
			requestedCount: 0,
			approvedCount: 0,
			changeRequestCount: 0,
			staleCount: 0,
		})
	})

	test('computes latest effective state, author exclusion, staleness, candidates, pending review, and capabilities', async () => {
		const later = new Date('2026-08-08T11:00:00Z')
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000070' as PullRequestReviewId,
				outcome: 'request_changes',
			},
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000071' as PullRequestReviewId,
				outcome: 'comment',
			},
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000072' as PullRequestReviewId,
				outcome: 'approve',
				submittedAt: later,
				headSha: 'old-head',
			},
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000073' as PullRequestReviewId,
				reviewer: nativeActor(mockUserId, 'marta'),
			},
		])
		vi.spyOn(reviewsRepository, 'findPendingReview').mockResolvedValue({
			id: reviewId,
			headSha: 'draft-head',
			commentCount: 2,
		})
		vi.spyOn(repositoriesService, 'listRepositoryPrincipals').mockResolvedValue(
			[
				{ userId: mockUserId, username: 'marta' },
				{ userId: reviewerUserId, username: 'reviewer' },
			]
		)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: 'base',
			headSha: 'current-head',
			mergeBaseSha: 'base',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})

		const state = await service.getReviewState({
			pullRequest,
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'write',
			viewerUserId: reviewerUserId,
		})

		expect(state.effectiveReviewStates).toEqual([
			expect.objectContaining({ outcome: 'approve', stale: true }),
		])
		expect(state.viewerPendingReview).toEqual({
			id: reviewId,
			headSha: 'draft-head',
			commentCount: 2,
		})
		expect(state.reviewerCandidates).toEqual([
			{ userId: reviewerUserId, username: 'reviewer' },
		])
		expect(state.viewer).toEqual({
			allowedOutcomes: ['approve', 'request_changes', 'comment'],
			canRequestReviewers: true,
			canRemoveReviewerRequests: true,
		})
	})

	test.each([
		['native author', pullRequest, mockUserId, ['comment']],
		[
			'GitHub-mapped author',
			{
				...pullRequest,
				provider: 'github' as const,
				authorUserId: null,
				authorActorNodeId: 'github-author-node',
				authorActorUserId: mockUserId,
			},
			mockUserId,
			['comment'],
		],
		[
			'authenticated reader',
			pullRequest,
			reviewerUserId,
			['approve', 'request_changes', 'comment'],
		],
		['anonymous reader', pullRequest, undefined, []],
		[
			'closed pull request reader',
			{ ...pullRequest, state: 'closed' as const, closedAt: createdAt },
			reviewerUserId,
			[],
		],
	] as const)('reports server-authoritative outcomes for a %s', async (_name, reviewedPullRequest, viewerUserId, allowedOutcomes) => {
		expect(
			(
				await service.getReviewState({
					pullRequest: reviewedPullRequest,
					repositoryId,
					storagePath: '/repositories/notes.git',
					viewerRole: 'read',
					viewerUserId,
				})
			).viewer.allowedOutcomes
		).toEqual(allowedOutcomes)
	})

	test('breaks equal submittedAt timestamps by descending review id', async () => {
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000070' as PullRequestReviewId,
				outcome: 'request_changes',
			},
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000071' as PullRequestReviewId,
				outcome: 'comment',
			},
		])
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: 'base',
			headSha: 'reviewed-head',
			mergeBaseSha: 'base',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})

		const state = await service.getReviewState({
			pullRequest,
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
		})

		expect(state.effectiveReviewStates).toEqual([
			expect.objectContaining({
				reviewId: '00000000-0000-4000-8000-000000000071',
				outcome: 'comment',
			}),
		])
	})

	test('reports no stale reviews for merged and closed list rows', async () => {
		vi.spyOn(reviewsRepository, 'listEffectiveReviews').mockResolvedValue([
			{
				pullRequestId,
				reviewer: nativeActor(reviewerUserId, 'reviewer'),
				outcome: 'approve',
				headSha: 'reviewed-head',
			},
		])
		const mergedPullRequest: PullRequestReadModel = {
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-commit',
			mergedAt: createdAt,
			closedAt: createdAt,
		}

		const summaries = await service.listReviewSummaries({
			headRefs: currentHeadRefs('moved-head'),
			pullRequests: [mergedPullRequest],
		})

		expect(summaries.get(pullRequestId)).toEqual({
			requestedCount: 0,
			approvedCount: 1,
			changeRequestCount: 0,
			staleCount: 0,
		})
	})

	test('ages out list reviews against the current head of an open pull request', async () => {
		vi.spyOn(reviewsRepository, 'listEffectiveReviews').mockResolvedValue([
			{
				pullRequestId,
				reviewer: nativeActor(reviewerUserId, 'reviewer'),
				outcome: 'approve',
				headSha: 'reviewed-head',
			},
		])
		const summaries = await service.listReviewSummaries({
			headRefs: currentHeadRefs('moved-head'),
			pullRequests: [pullRequest],
		})

		expect(summaries.get(pullRequestId)).toEqual({
			requestedCount: 0,
			approvedCount: 0,
			changeRequestCount: 0,
			staleCount: 1,
		})
	})

	test('uses the merged commit second parent as the effective review head', async () => {
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			{ ...submittedReview, headSha: 'merged-source-head' },
		])
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue({
			baseSha: 'base',
			headSha: 'merged-source-head',
			mergeBaseSha: 'base',
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})
		const mergedPullRequest: PullRequestReadModel = {
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'merge-commit',
			mergedAt: createdAt,
			closedAt: createdAt,
		}

		const state = await service.getReviewState({
			pullRequest: mergedPullRequest,
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
		})

		expect(gitStorageClient.compareRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({ headRef: 'merge-commit^2' })
		)
		expect(state.effectiveReviewStates[0]?.stale).toBeFalsy()
	})
})
