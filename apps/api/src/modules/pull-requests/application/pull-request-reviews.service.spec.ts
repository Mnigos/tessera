import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
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
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
	github: undefined,
}
const submittedReview = {
	id: reviewId,
	reviewerUserId,
	reviewerUsername: 'reviewer',
	outcome: 'approve' as const,
	body: '',
	headSha: 'reviewed-head',
	submittedAt: createdAt,
}
const reviewerRequest = {
	id: requestId,
	reviewerUserId,
	reviewerUsername: 'reviewer',
	requestedByUserId: mockUserId,
	requestedByUsername: 'marta',
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

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestReviewsService,
				{
					provide: PullRequestReviewsRepository,
					useValue: {
						createReviewerRequest: vi.fn(),
						removeReviewerRequest: vi.fn(),
						submitReview: vi.fn(),
						discardPendingReview: vi.fn(),
						listActiveReviewerRequests: vi.fn().mockResolvedValue([]),
						listSubmittedReviews: vi.fn().mockResolvedValue([]),
						findPendingReview: vi.fn(),
						listEffectiveReviews: vi.fn().mockResolvedValue([]),
						countActiveReviewerRequests: vi.fn().mockResolvedValue([]),
					},
				},
				{ provide: PullRequestsRepository, useValue: { find: vi.fn() } },
				{
					provide: RepositoriesService,
					useValue: {
						getReadableTesseraRepositoryContext: vi.fn(),
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
			],
		}).compile()
		service = moduleRef.get(PullRequestReviewsService)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		userService = moduleRef.get(UserService)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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

	test('rejects read-only strangers requesting or removing reviewers', async () => {
		vi.spyOn(
			repositoriesService,
			'getReadableTesseraRepositoryContext'
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
			'getReadableTesseraRepositoryContext'
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

	test('rejects the pull request author submitting a review', async () => {
		await expect(
			service.submitReview(mockUserId, {
				...repositoryInput,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: 'head',
			})
		).rejects.toBeInstanceOf(PullRequestReviewAuthorForbiddenError)
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
			'getReadableTesseraRepositoryContext'
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
		vi.spyOn(reviewsRepository, 'listSubmittedReviews').mockResolvedValue([
			{
				...submittedReview,
				id: '00000000-0000-4000-8000-000000000078' as PullRequestReviewId,
				reviewerUserId: null,
				reviewerUsername: null,
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
			tesseraWritesAllowed: true,
			viewerRole: 'read',
		})

		expect(state.reviews).toEqual([
			expect.objectContaining({ id: reviewId, reviewerUsername: 'reviewer' }),
		])
		expect(state.effectiveReviewStates).toEqual([
			expect.objectContaining({ reviewId, reviewerUsername: 'reviewer' }),
		])
	})

	test('leaves list reviews without a resolvable reviewer out of the summary counts', async () => {
		vi.spyOn(reviewsRepository, 'listEffectiveReviews').mockResolvedValue([
			{
				pullRequestId,
				reviewerUserId: null,
				reviewerUsername: null,
				outcome: 'approve',
				headSha: 'reviewed-head',
			},
		])
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'reviewed-head',
				},
			],
			tags: [],
		})

		const summaries = await service.listReviewSummaries({
			pullRequests: [pullRequest],
			repositoryId,
			storagePath: '/repositories/notes.git',
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
		vi.spyOn(reviewsRepository, 'listSubmittedReviews').mockResolvedValue([
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
				reviewerUserId: mockUserId,
				reviewerUsername: 'marta',
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
			tesseraWritesAllowed: true,
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
			canSubmitReview: true,
			canRequestReviewers: true,
			canRemoveReviewerRequests: true,
		})
	})

	test('breaks equal submittedAt timestamps by descending review id', async () => {
		vi.spyOn(reviewsRepository, 'listSubmittedReviews').mockResolvedValue([
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
			tesseraWritesAllowed: true,
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
				reviewerUserId,
				reviewerUsername: 'reviewer',
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
			pullRequests: [mergedPullRequest],
			repositoryId,
			storagePath: '/repositories/notes.git',
		})

		expect(summaries.get(pullRequestId)).toEqual({
			requestedCount: 0,
			approvedCount: 1,
			changeRequestCount: 0,
			staleCount: 0,
		})
		expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
	})

	test('ages out list reviews against the current head of an open pull request', async () => {
		vi.spyOn(reviewsRepository, 'listEffectiveReviews').mockResolvedValue([
			{
				pullRequestId,
				reviewerUserId,
				reviewerUsername: 'reviewer',
				outcome: 'approve',
				headSha: 'reviewed-head',
			},
		])
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'moved-head',
				},
			],
			tags: [],
		})

		const summaries = await service.listReviewSummaries({
			pullRequests: [pullRequest],
			repositoryId,
			storagePath: '/repositories/notes.git',
		})

		expect(summaries.get(pullRequestId)).toEqual({
			requestedCount: 0,
			approvedCount: 0,
			changeRequestCount: 0,
			staleCount: 1,
		})
	})

	test('uses the merged commit second parent as the effective review head', async () => {
		vi.spyOn(reviewsRepository, 'listSubmittedReviews').mockResolvedValue([
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
			tesseraWritesAllowed: true,
			viewerRole: 'read',
		})

		expect(gitStorageClient.compareRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({ headRef: 'merge-commit^2' })
		)
		expect(state.effectiveReviewStates[0]?.stale).toBeFalsy()
	})
})
