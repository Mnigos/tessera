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
import {
	type PullRequestActorReadModel,
	requirePullRequestActorOutput,
	toPullRequestActorOutput,
} from './pull-request-actor'

export interface PullRequestReviewEvaluationContext {
	authorUserId: UserId | null
	/** The author's GitHub identity, which is all an unmapped author has. */
	authorActorNodeId?: string | null
	/** Undefined when the current head cannot be resolved; nothing is stale then. */
	currentHeadSha?: string
}

export function toPullRequestReviewOutput(
	review: PullRequestReviewReadModel
): PullRequestReviewOutput {
	if (!(review.outcome && review.submittedAt))
		throw new Error('pull request review is not submitted')

	return {
		id: review.id,
		reviewer: requirePullRequestActorOutput(
			review.reviewer,
			'pull request reviewer'
		),
		state: review.state,
		outcome: review.outcome,
		body: review.body,
		headSha: review.headSha,
		submittedAt: review.submittedAt,
		dismissedAt: review.dismissedAt ?? undefined,
		dismissedBy: toPullRequestActorOutput(review.dismissedBy),
		sourceUrl: review.sourceUrl ?? undefined,
	}
}

/**
 * Whether the review can be attributed to anybody at all. Both a Tessera
 * account and a GitHub actor snapshot count — a synchronized reviewer Tessera
 * never linked still reviewed the pull request — but a row with neither has
 * nobody to show and is left out of history, effective state, and counts alike.
 */
export function isAttributableReview({
	reviewer,
}: {
	reviewer: PullRequestActorReadModel
}): boolean {
	return toPullRequestActorOutput(reviewer) !== undefined
}

export function toPullRequestReviewerRequestOutput(
	request: PullRequestReviewerRequestReadModel
): PullRequestReviewerRequestOutput {
	return {
		id: request.id,
		targetKind: request.targetKind,
		reviewer: requirePullRequestActorOutput(
			request.reviewer,
			'pull request requested reviewer'
		),
		// REST only reports who is requested, never who asked, so a request
		// recovered by reconciliation has no requester to name.
		requestedBy: toPullRequestActorOutput(request.requestedBy),
		createdAt: request.createdAt,
	}
}

/**
 * Reduces the submitted review history to one effective state per reviewer:
 * the latest submission wins, ties break on review id, and the pull request
 * author never counts as a reviewer of their own pull request.
 *
 * Dismissed reviews drop out here. They stay in the history so the record of
 * the decision survives, but a dismissed verdict no longer describes the pull
 * request.
 */
export function toPullRequestEffectiveReviewStates(
	reviews: PullRequestReviewReadModel[],
	{
		authorActorNodeId,
		authorUserId,
		currentHeadSha,
	}: PullRequestReviewEvaluationContext
): PullRequestEffectiveReviewState[] {
	const latestByReviewer = new Map<string, PullRequestReviewReadModel>()

	for (const review of reviews) {
		if (review.state !== 'submitted') continue
		if (!(review.outcome && review.submittedAt)) continue

		const reviewer = toPullRequestActorOutput(review.reviewer)

		if (!reviewer) continue
		if (isPullRequestAuthor(reviewer, { authorActorNodeId, authorUserId }))
			continue

		const latestReview = latestByReviewer.get(reviewer.key)

		if (!latestReview || supersedes(review, latestReview))
			latestByReviewer.set(reviewer.key, review)
	}

	return [...latestByReviewer.values()]
		.map(review => {
			const { headSha, id, outcome, reviewer, submittedAt } =
				toPullRequestReviewOutput(review)

			return {
				reviewId: id,
				reviewer,
				outcome,
				headSha,
				submittedAt,
				stale: isStaleReviewHead(review.headSha, currentHeadSha),
			}
		})
		.sort((left, right) =>
			left.reviewer.username.localeCompare(right.reviewer.username)
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
		if (!isAttributableReview(review)) continue

		const stale = isStaleReviewHead(review.headSha, currentHeadSha)

		if (stale) staleCount += 1
		if (review.outcome === 'approve' && !stale) approvedCount += 1
		if (review.outcome === 'request_changes' && !stale) changeRequestCount += 1
	}

	return { requestedCount, approvedCount, changeRequestCount, staleCount }
}

/**
 * A pull request author cannot review their own work — including when they
 * reach it through GitHub, where the same person may be the unmapped author
 * actor rather than a Tessera account.
 */
function isPullRequestAuthor(
	reviewer: { externalNodeId?: string; userId?: UserId },
	{
		authorActorNodeId,
		authorUserId,
	}: Pick<
		PullRequestReviewEvaluationContext,
		'authorActorNodeId' | 'authorUserId'
	>
): boolean {
	if (authorUserId && reviewer.userId === authorUserId) return true

	return Boolean(
		authorActorNodeId && reviewer.externalNodeId === authorActorNodeId
	)
}

function isStaleReviewHead(
	reviewHeadSha: string,
	currentHeadSha: string | undefined
): boolean {
	if (!currentHeadSha) return false

	return reviewHeadSha !== currentHeadSha
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
