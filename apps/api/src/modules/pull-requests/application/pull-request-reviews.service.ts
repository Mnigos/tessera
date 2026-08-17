import {
	type GitHubWriteThroughContext,
	GitHubWriteThroughService,
	toGitHubWriteThroughContext,
} from '@modules/github-write-through'
import {
	type GitHubWriteThroughTarget,
	RepositoriesService,
} from '@modules/repositories'
import { UserService } from '@modules/user'
import { Injectable } from '@nestjs/common'
import type {
	ParsedGetPullRequestInput,
	ParsedRequestPullRequestReviewerInput,
	ParsedSubmitPullRequestReviewInput,
	PullRequestEffectiveReviewState,
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewOutcome,
	PullRequestReviewSummary,
	PullRequestReviewViewer,
} from '@repo/contracts'
import {
	canWriteRepository,
	type PullRequestId,
	type PullRequestReviewerRequestId,
	type PullRequestReviewId,
	type RepositoryId,
	type RepositoryRole,
	type UserId,
} from '@repo/domain'
import { getPullRequestAuthorUserId } from '../domain/pull-request'
import {
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import {
	isAttributableReview,
	toAllowedPullRequestReviewOutcomes,
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
	PullRequestReviewerRequestNotFoundError,
	PullRequestReviewNotFoundError,
} from '../domain/pull-request-review.errors'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import {
	type PullRequestHeadRef,
	PullRequestHeadResolver,
} from './pull-request-head.resolver'

export interface PullRequestReviewState {
	effectiveReviewStates: PullRequestEffectiveReviewState[]
	reviewerCandidates: PullRequestReviewerCandidate[]
	reviewerRequests: PullRequestReviewerRequest[]
	reviews: PullRequestReview[]
	viewer: PullRequestReviewViewer
	viewerPendingReview?: PullRequestPendingReview
}

interface PullRequestReviewContext {
	gitHubTarget?: GitHubWriteThroughTarget
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
	viewerRole: RepositoryRole
}

interface GetReviewStateParams
	extends Omit<PullRequestReviewContext, 'gitHubTarget'> {
	viewerUserId?: UserId
}

interface ListReviewSummariesParams {
	headRefs: Map<PullRequestId, PullRequestHeadRef>
	pullRequests: PullRequestReadModel[]
}

@Injectable()
export class PullRequestReviewsService {
	constructor(
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestHeadResolver: PullRequestHeadResolver,
		private readonly repositoriesService: RepositoriesService,
		private readonly userService: UserService,
		private readonly gitHubWriteThroughService: GitHubWriteThroughService
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
		const context = await this.getOpenPullRequestContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const { pullRequest } = context
		const reviewerUserId = await this.resolveEligibleReviewer(
			{ number, slug, username },
			pullRequest,
			reviewerUsername
		)
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return toPullRequestReviewerRequestOutput(
				await this.requireReviewerRequest(
					await this.gitHubWriteThroughService.requestReviewer(writeThrough, {
						reviewerUserId,
					})
				)
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
		const context = await this.getOpenPullRequestContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const { pullRequest } = context
		const reviewerUserId = await this.userService.findUserId({
			username: reviewerUsername,
		})
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return {
				removed: await this.gitHubWriteThroughService.removeReviewerRequest(
					writeThrough,
					{ reviewerUserId }
				),
			}

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
		const context = await this.getOpenPullRequestContext(
			viewerUserId,
			{ number, slug, username },
			{ requireWriteRole: false }
		)
		const { pullRequest } = context

		assertAllowedReviewOutcome(pullRequest, viewerUserId, outcome)

		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return toPullRequestReviewOutput(
				await this.requireReview(
					pullRequest.id,
					await this.gitHubWriteThroughService.submitReview(writeThrough, {
						body: body ?? '',
						expectedHeadSha,
						outcome,
					})
				)
			)

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
		const context = await this.getOpenPullRequestContext(viewerUserId, input, {
			requireWriteRole: false,
		})
		const { pullRequest } = context

		// GitHub holds the drafts on a mirror; Tessera keeps none to discard.
		if (context.gitHubTarget) return { discarded: false }

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
		viewerRole,
		viewerUserId,
	}: GetReviewStateParams): Promise<PullRequestReviewState> {
		const authorUserId = getPullRequestAuthorUserId(pullRequest)
		const isAuthor = viewerUserId !== undefined && authorUserId === viewerUserId
		const canReview = viewerUserId !== undefined && pullRequest.state === 'open'
		const viewer: PullRequestReviewViewer = {
			allowedOutcomes: canReview
				? toAllowedPullRequestReviewOutcomes(isAuthor)
				: [],
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
				this.pullRequestReviewsRepository.listReviewHistory({
					pullRequestId: pullRequest.id,
				}),
				viewerUserId
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
				? await this.pullRequestHeadResolver.resolveCurrentHeadSha({
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
				authorUserId,
				authorActorNodeId: pullRequest.authorActorNodeId,
				currentHeadSha,
			}),
			viewerPendingReview: pendingReview,
			reviewerCandidates: principals.filter(
				principal => principal.userId !== authorUserId
			),
			viewer,
		}
	}

	/**
	 * Review badges for a whole list page. Batched across every pull request so
	 * list rendering never issues per-row review queries.
	 */
	async listReviewSummaries({
		headRefs,
		pullRequests,
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
		const headShas = toStalenessHeadShas(headRefs, pullRequests)

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

	private async requireReviewerRequest(
		requestId: PullRequestReviewerRequestId
	) {
		const request = await this.pullRequestReviewsRepository.findReviewerRequest(
			{
				requestId,
			}
		)

		if (!request)
			throw new PullRequestReviewerRequestNotFoundError({ requestId })

		return request
	}

	private async requireReview(
		pullRequestId: PullRequestId,
		reviewId: PullRequestReviewId
	) {
		const review = await this.pullRequestReviewsRepository.findReview({
			pullRequestId,
			reviewId,
		})

		if (!review)
			throw new PullRequestReviewNotFoundError({ pullRequestId, reviewId })

		return review
	}

	private async resolveEligibleReviewer(
		input: ParsedGetPullRequestInput,
		pullRequest: PullRequestReadModel,
		reviewerUsername: string
	): Promise<UserId> {
		const reviewerUserId = await this.userService.findUserId({
			username: reviewerUsername,
		})

		if (reviewerUserId === getPullRequestAuthorUserId(pullRequest))
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
		const { gitHubTarget, repositoryId, storagePath, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
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
			getPullRequestAuthorUserId(pullRequest) !== viewerUserId &&
			!canWriteRepository(viewerRole)
		)
			throw new PullRequestReviewerRequestForbiddenError({
				pullRequestId: pullRequest.id,
				userId: viewerUserId,
			})

		return { gitHubTarget, pullRequest, repositoryId, storagePath, viewerRole }
	}

	private toWriteThroughContext(
		viewerUserId: UserId,
		{ gitHubTarget, pullRequest, repositoryId }: PullRequestReviewContext
	): GitHubWriteThroughContext | undefined {
		return toGitHubWriteThroughContext(viewerUserId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})
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

/**
 * Heads a staleness badge may speak for.
 *
 * Scoped to open pull requests: a merged or closed row's reviews are historical
 * and never read as stale, and a head the resolver could not confirm must not
 * age out every review stored against it.
 */
function toStalenessHeadShas(
	headRefs: Map<PullRequestId, PullRequestHeadRef>,
	pullRequests: PullRequestReadModel[]
): Map<PullRequestId, string> {
	const openPullRequestIds = new Set(
		pullRequests
			.filter(pullRequest => pullRequest.state === 'open')
			.map(pullRequest => pullRequest.id)
	)

	return new Map(
		[...headRefs]
			.filter(
				([pullRequestId, headRef]) =>
					headRef.isCurrent && openPullRequestIds.has(pullRequestId)
			)
			.map(([pullRequestId, headRef]) => [pullRequestId, headRef.sha])
	)
}

function assertAllowedReviewOutcome(
	pullRequest: PullRequestReadModel,
	viewerUserId: UserId,
	outcome: PullRequestReviewOutcome
): void {
	const allowedOutcomes = toAllowedPullRequestReviewOutcomes(
		getPullRequestAuthorUserId(pullRequest) === viewerUserId
	)

	if (allowedOutcomes.includes(outcome)) return

	throw new PullRequestReviewAuthorForbiddenError({
		pullRequestId: pullRequest.id,
		userId: viewerUserId,
		outcome,
	})
}
