import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { UserService } from '@modules/user'
import { Injectable, Logger } from '@nestjs/common'
import type {
	ParsedGetPullRequestInput,
	ParsedRequestPullRequestReviewerInput,
	ParsedSubmitPullRequestReviewInput,
	PullRequestEffectiveReviewState,
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewSummary,
	PullRequestReviewViewer,
} from '@repo/contracts'
import {
	canWriteRepository,
	type PullRequestId,
	type RepositoryId,
	type RepositoryRole,
	type UserId,
} from '@repo/domain'
import {
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import {
	isAttributableReview,
	toPullRequestEffectiveReviewStates,
	toPullRequestReviewerRequestOutput,
	toPullRequestReviewOutput,
	toPullRequestReviewSummary,
} from '../domain/pull-request-review'
import {
	PullRequestPendingReviewConflictError,
	PullRequestReviewAuthorForbiddenError,
	PullRequestReviewerAlreadyRequestedError,
	PullRequestReviewerIneligibleError,
	PullRequestReviewerRequestForbiddenError,
} from '../domain/pull-request-review.errors'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'

export interface PullRequestReviewState {
	effectiveReviewStates: PullRequestEffectiveReviewState[]
	reviewerCandidates: PullRequestReviewerCandidate[]
	reviewerRequests: PullRequestReviewerRequest[]
	reviews: PullRequestReview[]
	viewer: PullRequestReviewViewer
	viewerPendingReview?: PullRequestPendingReview
}

interface PullRequestReviewContext {
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
	tesseraWritesAllowed: boolean
	viewerRole: RepositoryRole
}

interface GetReviewStateParams extends PullRequestReviewContext {
	viewerUserId?: UserId
}

interface ListReviewSummariesParams {
	pullRequests: PullRequestReadModel[]
	repositoryId: RepositoryId
	storagePath: string
}

@Injectable()
export class PullRequestReviewsService {
	private readonly logger = new Logger(PullRequestReviewsService.name)

	constructor(
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly userService: UserService,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async requestReviewer(
		viewerUserId: UserId,
		{
			number,
			reviewerUsername,
			slug,
			username,
		}: ParsedRequestPullRequestReviewerInput
	): Promise<PullRequestReviewerRequest> {
		const { pullRequest } = await this.getOpenPullRequestContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const reviewerUserId = await this.resolveEligibleReviewer(
			{ number, slug, username },
			pullRequest,
			reviewerUsername
		)
		const result =
			await this.pullRequestReviewsRepository.createReviewerRequest({
				pullRequestId: pullRequest.id,
				reviewerUserId,
				requestedByUserId: viewerUserId,
				reviewerUsername,
			})

		if (result.status === 'pull_request_closed')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'request reviewer',
			})

		if (result.status === 'already_requested')
			throw new PullRequestReviewerAlreadyRequestedError({
				pullRequestId: pullRequest.id,
				reviewerUsername,
			})

		return toPullRequestReviewerRequestOutput(result.request)
	}

	async removeReviewerRequest(
		viewerUserId: UserId,
		{
			number,
			reviewerUsername,
			slug,
			username,
		}: ParsedRequestPullRequestReviewerInput
	): Promise<{ removed: boolean }> {
		const { pullRequest } = await this.getOpenPullRequestContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const reviewerUserId = await this.userService.findUserId({
			username: reviewerUsername,
		})
		const removed =
			await this.pullRequestReviewsRepository.removeReviewerRequest({
				pullRequestId: pullRequest.id,
				reviewerUserId,
				removedByUserId: viewerUserId,
				removedAt: new Date(),
				reviewerUsername,
			})

		return { removed }
	}

	async submitReview(
		viewerUserId: UserId,
		{
			body,
			expectedHeadSha,
			number,
			outcome,
			slug,
			username,
		}: ParsedSubmitPullRequestReviewInput
	): Promise<PullRequestReview> {
		const { pullRequest } = await this.getOpenPullRequestContext(
			viewerUserId,
			{ number, slug, username },
			{ requireWriteRole: false }
		)

		assertPullRequestReviewer(pullRequest, viewerUserId)

		// The envelope is identified before the submission takes the pull request
		// lock, so two simultaneous submissions race for the same review row and
		// the loser conflicts instead of opening a second review.
		const pendingReview =
			await this.pullRequestReviewsRepository.findPendingReview({
				pullRequestId: pullRequest.id,
				reviewerUserId: viewerUserId,
			})
		const result = await this.pullRequestReviewsRepository.submitReview({
			pullRequestId: pullRequest.id,
			reviewerUserId: viewerUserId,
			pendingReviewId: pendingReview?.id,
			outcome,
			body: body ?? '',
			headSha: expectedHeadSha,
			submittedAt: new Date(),
		})

		if (result.status === 'pull_request_closed')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'submit review',
			})

		if (result.status === 'pending_review_conflict')
			throw new PullRequestPendingReviewConflictError({
				pullRequestId: pullRequest.id,
				userId: viewerUserId,
			})

		return toPullRequestReviewOutput(result.review)
	}

	async discardPendingReview(
		viewerUserId: UserId,
		input: ParsedGetPullRequestInput
	): Promise<{ discarded: boolean }> {
		const { pullRequest } = await this.getOpenPullRequestContext(
			viewerUserId,
			input,
			{ requireWriteRole: false }
		)

		assertPullRequestReviewer(pullRequest, viewerUserId)

		const discarded =
			await this.pullRequestReviewsRepository.discardPendingReview({
				pullRequestId: pullRequest.id,
				reviewerUserId: viewerUserId,
			})

		return { discarded }
	}

	async getReviewState({
		pullRequest,
		repositoryId,
		storagePath,
		tesseraWritesAllowed,
		viewerRole,
		viewerUserId,
	}: GetReviewStateParams): Promise<PullRequestReviewState> {
		const isAuthor =
			viewerUserId !== undefined && pullRequest.authorUserId === viewerUserId
		const canReview =
			viewerUserId !== undefined &&
			tesseraWritesAllowed &&
			pullRequest.state === 'open'
		const viewer: PullRequestReviewViewer = {
			canSubmitReview: canReview && !isAuthor,
			canRequestReviewers:
				canReview && (isAuthor || canWriteRepository(viewerRole)),
			canRemoveReviewerRequests:
				canReview && (isAuthor || canWriteRepository(viewerRole)),
		}

		const [reviewerRequests, reviews, pendingReview, principals] =
			await Promise.all([
				this.pullRequestReviewsRepository.listActiveReviewerRequests({
					pullRequestId: pullRequest.id,
				}),
				this.pullRequestReviewsRepository.listSubmittedReviews({
					pullRequestId: pullRequest.id,
				}),
				viewerUserId && !isAuthor
					? this.pullRequestReviewsRepository.findPendingReview({
							pullRequestId: pullRequest.id,
							reviewerUserId: viewerUserId,
						})
					: undefined,
				viewer.canRequestReviewers
					? this.repositoriesService.listRepositoryPrincipals(repositoryId)
					: [],
			])
		const currentHeadSha =
			reviews.length > 0
				? await this.resolveCurrentHeadSha({
						pullRequest,
						repositoryId,
						storagePath,
					})
				: undefined

		return {
			reviewerRequests: reviewerRequests.map(
				toPullRequestReviewerRequestOutput
			),
			reviews: reviews
				.filter(isAttributableReview)
				.map(toPullRequestReviewOutput),
			effectiveReviewStates: toPullRequestEffectiveReviewStates(reviews, {
				authorUserId: pullRequest.authorUserId,
				currentHeadSha,
			}),
			viewerPendingReview: pendingReview,
			reviewerCandidates: principals.filter(
				principal => principal.userId !== pullRequest.authorUserId
			),
			viewer,
		}
	}

	/**
	 * Review badges for a whole list page. Batched across every pull request so
	 * list rendering never issues per-row review queries.
	 */
	async listReviewSummaries({
		pullRequests,
		repositoryId,
		storagePath,
	}: ListReviewSummariesParams): Promise<
		Map<PullRequestId, PullRequestReviewSummary>
	> {
		const pullRequestIds = pullRequests.map(pullRequest => pullRequest.id)
		const [effectiveReviews, requestCounts] = await Promise.all([
			this.pullRequestReviewsRepository.listEffectiveReviews(pullRequestIds),
			this.pullRequestReviewsRepository.countActiveReviewerRequests(
				pullRequestIds
			),
		])
		const requestedCounts = new Map(
			requestCounts.map(row => [row.pullRequestId, row.requestedCount])
		)
		const reviewsByPullRequest = Map.groupBy(
			effectiveReviews,
			review => review.pullRequestId
		)
		const headShas = await this.resolveListHeadShas({
			pullRequests: pullRequests.filter(pullRequest =>
				reviewsByPullRequest.has(pullRequest.id)
			),
			repositoryId,
			storagePath,
		})

		return new Map(
			pullRequests.map(pullRequest => [
				pullRequest.id,
				toPullRequestReviewSummary(
					reviewsByPullRequest.get(pullRequest.id) ?? [],
					requestedCounts.get(pullRequest.id) ?? 0,
					headShas.get(pullRequest.id)
				),
			])
		)
	}

	private async resolveEligibleReviewer(
		input: ParsedGetPullRequestInput,
		pullRequest: PullRequestReadModel,
		reviewerUsername: string
	): Promise<UserId> {
		const reviewerUserId = await this.userService.findUserId({
			username: reviewerUsername,
		})

		if (reviewerUserId === pullRequest.authorUserId)
			throw new PullRequestReviewerIneligibleError({
				pullRequestId: pullRequest.id,
				reviewerUsername,
				reason: 'author',
			})

		const canRead = await this.repositoriesService.canUserReadRepository(
			reviewerUserId,
			input
		)

		if (!canRead)
			throw new PullRequestReviewerIneligibleError({
				pullRequestId: pullRequest.id,
				reviewerUsername,
				reason: 'unreadable_repository',
			})

		return reviewerUserId
	}

	private async getOpenPullRequestContext(
		viewerUserId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput,
		{ requireWriteRole = true }: { requireWriteRole?: boolean } = {}
	): Promise<PullRequestReviewContext> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableTesseraRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)

		if (pullRequest.state !== 'open')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'review',
			})

		if (
			requireWriteRole &&
			pullRequest.authorUserId !== viewerUserId &&
			!canWriteRepository(viewerRole)
		)
			throw new PullRequestReviewerRequestForbiddenError({
				pullRequestId: pullRequest.id,
				userId: viewerUserId,
			})

		return {
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			viewerRole,
		}
	}

	/**
	 * Head the pull request currently points at, used to age out reviews. Returns
	 * undefined when git cannot resolve it — an unresolvable head must not make
	 * every stored review look stale.
	 */
	private async resolveCurrentHeadSha({
		pullRequest,
		repositoryId,
		storagePath,
	}: Pick<
		PullRequestReviewContext,
		'pullRequest' | 'repositoryId' | 'storagePath'
	>): Promise<string | undefined> {
		if (pullRequest.github) return pullRequest.github.headSha

		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)

		try {
			const { headSha } = await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef,
				headRef,
			})

			return headSha
		} catch (error) {
			this.logger.warn(
				`Failed to resolve the current head of pull request ${pullRequest.id}`,
				error instanceof Error ? error.stack : undefined
			)

			return undefined
		}
	}

	/**
	 * Current heads for a list page: one refs lookup for every native pull
	 * request instead of a comparison per row.
	 *
	 * Staleness is scoped to open pull requests. Merged and closed rows report no
	 * stale reviews because their outcomes are historical, and resolving their
	 * real head (a merge commit's second parent) would cost a git call per row.
	 * The detail view keeps that resolution and stays authoritative.
	 */
	private async resolveListHeadShas({
		pullRequests,
		repositoryId,
		storagePath,
	}: ListReviewSummariesParams): Promise<Map<PullRequestId, string>> {
		const headShas = new Map<PullRequestId, string>()
		const openPullRequests = pullRequests.filter(
			pullRequest => pullRequest.state === 'open'
		)
		const nativePullRequests = openPullRequests.filter(
			pullRequest => !pullRequest.github
		)

		for (const pullRequest of openPullRequests)
			if (pullRequest.github)
				headShas.set(pullRequest.id, pullRequest.github.headSha)

		if (nativePullRequests.length === 0) return headShas

		try {
			const refs = await this.gitStorageClient.listRepositoryRefs({
				repositoryId,
				storagePath,
				trustedGpgKeys: [],
			})
			const branchTargets = new Map(
				refs.branches.map(branch => [branch.name, branch.target])
			)

			for (const pullRequest of nativePullRequests) {
				const target = branchTargets.get(pullRequest.sourceBranch)

				if (target) headShas.set(pullRequest.id, target)
			}
		} catch (error) {
			this.logger.warn(
				`Failed to resolve current heads for repository ${repositoryId}`,
				error instanceof Error ? error.stack : undefined
			)
		}

		return headShas
	}

	private async findPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestReadModel> {
		const pullRequest = await this.pullRequestsRepository.find({
			repositoryId,
			number,
		})

		if (!pullRequest)
			throw new PullRequestNotFoundError({ repositoryId, number })

		return pullRequest
	}
}

function assertPullRequestReviewer(
	pullRequest: PullRequestReadModel,
	viewerUserId: UserId
): void {
	if (pullRequest.authorUserId !== viewerUserId) return

	throw new PullRequestReviewAuthorForbiddenError({
		pullRequestId: pullRequest.id,
		userId: viewerUserId,
	})
}
