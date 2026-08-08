import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerRequest as PullRequestReviewerRequestOutput,
	PullRequestReview as PullRequestReviewOutput,
	PullRequestReviewSummary,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import type {
	PullRequestEffectiveReviewRow,
	PullRequestReviewerRequestReadModel,
	PullRequestReviewReadModel,
} from '../infrastructure/pull-request-reviews.repository'

export interface PullRequestReviewEvaluationContext {
	authorUserId: UserId | null
	/** Undefined when the current head cannot be resolved; nothing is stale then. */
	currentHeadSha?: string
}

export function toPullRequestReviewOutput(
	review: PullRequestReviewReadModel
): PullRequestReviewOutput {
	if (!review.reviewerUsername)
		throw new Error('pull request review reviewer username is unavailable')
	if (!(review.outcome && review.submittedAt))
		throw new Error('pull request review is not submitted')

	return {
		id: review.id,
		reviewerUserId: review.reviewerUserId ?? undefined,
		reviewerUsername: review.reviewerUsername,
		outcome: review.outcome,
		body: review.body,
		headSha: review.headSha,
		submittedAt: review.submittedAt,
	}
}

export function toPullRequestReviewerRequestOutput(
	request: PullRequestReviewerRequestReadModel
): PullRequestReviewerRequestOutput {
	if (!request.reviewerUsername)
		throw new Error('pull request reviewer username is unavailable')
	if (!request.requestedByUsername)
		throw new Error('pull request reviewer requester username is unavailable')

	return {
		id: request.id,
		reviewerUserId: request.reviewerUserId ?? undefined,
		reviewerUsername: request.reviewerUsername,
		requestedByUserId: request.requestedByUserId ?? undefined,
		requestedByUsername: request.requestedByUsername,
		createdAt: request.createdAt,
	}
}

/**
 * Reduces the submitted review history to one effective state per reviewer:
 * the latest submission wins, ties break on review id, and the pull request
 * author never counts as a reviewer of their own pull request.
 */
export function toPullRequestEffectiveReviewStates(
	reviews: PullRequestReviewReadModel[],
	{ authorUserId, currentHeadSha }: PullRequestReviewEvaluationContext
): PullRequestEffectiveReviewState[] {
	const latestByReviewer = new Map<string, PullRequestReviewReadModel>()

	for (const review of reviews) {
		if (!(review.outcome && review.submittedAt && review.reviewerUsername))
			continue
		if (authorUserId && review.reviewerUserId === authorUserId) continue

		const reviewerKey = toReviewerKey(review)
		const latestReview = latestByReviewer.get(reviewerKey)

		if (!latestReview || supersedes(review, latestReview))
			latestByReviewer.set(reviewerKey, review)
	}

	return [...latestByReviewer.values()]
		.map(review => {
			const { body: _body, id, ...output } = toPullRequestReviewOutput(review)

			return {
				...output,
				reviewId: id,
				stale: isStaleReviewHead(review.headSha, currentHeadSha),
			}
		})
		.sort((left, right) =>
			left.reviewerUsername.localeCompare(right.reviewerUsername)
		)
}

export function toPullRequestReviewSummary(
	effectiveReviews: PullRequestEffectiveReviewRow[],
	requestedCount: number,
	currentHeadSha: string | undefined
): PullRequestReviewSummary {
	let approvedCount = 0
	let changeRequestCount = 0
	let staleCount = 0

	for (const review of effectiveReviews) {
		const stale = isStaleReviewHead(review.headSha, currentHeadSha)

		if (stale) staleCount += 1
		if (review.outcome === 'approve' && !stale) approvedCount += 1
		if (review.outcome === 'request_changes' && !stale) changeRequestCount += 1
	}

	return { requestedCount, approvedCount, changeRequestCount, staleCount }
}

function isStaleReviewHead(
	reviewHeadSha: string,
	currentHeadSha: string | undefined
): boolean {
	if (!currentHeadSha) return false

	return reviewHeadSha !== currentHeadSha
}

function toReviewerKey(review: PullRequestReviewReadModel): string {
	return review.reviewerUserId ?? `username:${review.reviewerUsername}`
}

function supersedes(
	review: PullRequestReviewReadModel,
	current: PullRequestReviewReadModel
): boolean {
	if (!(review.submittedAt && current.submittedAt)) return false
	if (review.submittedAt.getTime() !== current.submittedAt.getTime())
		return review.submittedAt > current.submittedAt

	return review.id > current.id
}
