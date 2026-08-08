import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type {
	PullRequestReviewerTargetKind,
	PullRequestReviewOutcome,
	PullRequestReviewState,
} from '@repo/contracts'
import {
	and,
	asc,
	count,
	type DrizzleTransaction,
	desc,
	eq,
	gitHubActors,
	gitHubPullRequestMappings,
	gitHubPullRequestReviewerRequestMappings,
	gitHubPullRequestReviewMappings,
	inArray,
	isNull,
	type PullRequestEvent,
	type PullRequestEventPayload,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	sql,
	user,
} from '@repo/db'
import type {
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	UserId,
} from '@repo/domain'
import { alias, type PgColumn } from 'drizzle-orm/pg-core'
import type { PullRequestActorReadModel } from '../domain/pull-request-actor'

interface PullRequestParams {
	pullRequestId: PullRequestId
}

interface ReviewerParams extends PullRequestParams {
	reviewerUserId: UserId
}

interface GetOrCreatePendingReviewParams extends ReviewerParams {
	headSha: string
}

interface CreateReviewerRequestParams extends ReviewerParams {
	requestedByUserId: UserId
	reviewerUsername: string
}

interface RemoveReviewerRequestParams extends ReviewerParams {
	removedByUserId: UserId
	removedAt: Date
	reviewerUsername: string
}

interface SubmitReviewParams extends ReviewerParams {
	outcome: PullRequestReviewOutcome
	body: string
	headSha: string
	/** Identity of the envelope being sealed; absent for a direct submission. */
	pendingReviewId?: PullRequestReviewId
	submittedAt: Date
}

export type PullRequestReviewSubmissionResult =
	| { status: 'submitted'; review: PullRequestReviewReadModel }
	| { status: 'pull_request_closed' }
	| { status: 'pending_review_conflict' }

export type PullRequestReviewerRequestResult =
	| { status: 'created'; request: PullRequestReviewerRequestReadModel }
	| { status: 'pull_request_closed' }
	| { status: 'already_requested' }

export interface PullRequestReviewReadModel {
	id: PullRequestReviewId
	reviewer: PullRequestActorReadModel
	state: PullRequestReviewState
	outcome: PullRequestReviewOutcome | null
	body: string
	headSha: string
	submittedAt: Date | null
	dismissedAt: Date | null
	dismissedBy: PullRequestActorReadModel
	sourceUrl: string | null
}

export interface PullRequestReviewerRequestReadModel {
	id: PullRequestReviewerRequestId
	targetKind: PullRequestReviewerTargetKind
	reviewer: PullRequestActorReadModel
	requestedBy: PullRequestActorReadModel
	createdAt: Date
}

export interface PullRequestPendingReviewReadModel {
	id: PullRequestReviewId
	headSha: string
	commentCount: number
}

export interface PullRequestEffectiveReviewRow {
	pullRequestId: PullRequestId
	reviewer: PullRequestActorReadModel
	outcome: PullRequestReviewOutcome | null
	headSha: string
}

export interface PullRequestReviewerRequestCountRow {
	pullRequestId: PullRequestId
	requestedCount: number
}

type PullRequestReviewDatabase = Database | DrizzleTransaction

const reviewerUser = alias(user, 'pull_request_review_reviewer_user')
const requestedByUser = alias(user, 'pull_request_reviewer_request_requester')
const dismissedByUser = alias(user, 'pull_request_review_dismissed_by_user')
const reviewerGitHubActor = alias(
	gitHubActors,
	'pull_request_review_reviewer_github_actor'
)
const dismissedByGitHubActor = alias(
	gitHubActors,
	'pull_request_review_dismissed_by_github_actor'
)
const requestTargetGitHubActor = alias(
	gitHubActors,
	'pull_request_reviewer_request_target_github_actor'
)
const requestedByGitHubActor = alias(
	gitHubActors,
	'pull_request_reviewer_request_requester_github_actor'
)

/**
 * Groups a reviewer's submissions under one identity. Native reviewers key on
 * their account; a GitHub reviewer Tessera never linked keys on the actor node
 * ID, because every one of them has a null user ID and collapsing on that would
 * merge unrelated people into a single verdict.
 */
const EFFECTIVE_REVIEWER_KEY = sql`coalesce(${pullRequestReviews.reviewerUserId}::text, ${reviewerGitHubActor.externalNodeId})`

const REVIEW_READ_COLUMNS = {
	id: pullRequestReviews.id,
	reviewer: {
		userId: pullRequestReviews.reviewerUserId,
		username: reviewerUser.username,
		externalNodeId: reviewerGitHubActor.externalNodeId,
		externalLogin: reviewerGitHubActor.login,
		externalAvatarUrl: reviewerGitHubActor.avatarUrl,
		externalHtmlUrl: reviewerGitHubActor.htmlUrl,
	},
	state: pullRequestReviews.state,
	outcome: pullRequestReviews.outcome,
	body: pullRequestReviews.body,
	headSha: pullRequestReviews.headSha,
	submittedAt: pullRequestReviews.submittedAt,
	dismissedAt: pullRequestReviews.dismissedAt,
	dismissedBy: {
		userId: pullRequestReviews.dismissedByUserId,
		username: dismissedByUser.username,
		externalNodeId: dismissedByGitHubActor.externalNodeId,
		externalLogin: dismissedByGitHubActor.login,
		externalAvatarUrl: dismissedByGitHubActor.avatarUrl,
		externalHtmlUrl: dismissedByGitHubActor.htmlUrl,
	},
	sourceUrl: gitHubPullRequestReviewMappings.htmlUrl,
}

const REVIEWER_REQUEST_READ_COLUMNS = {
	id: pullRequestReviewerRequests.id,
	targetKind: sql<PullRequestReviewerTargetKind>`coalesce(${gitHubPullRequestReviewerRequestMappings.targetKind}, 'user')`,
	reviewer: {
		userId: pullRequestReviewerRequests.reviewerUserId,
		username: reviewerUser.username,
		// A team has no actor row, so its snapshot on the mapping stands in for one.
		externalNodeId: sql<
			string | null
		>`coalesce(${requestTargetGitHubActor.externalNodeId}, ${gitHubPullRequestReviewerRequestMappings.targetNodeId})`,
		externalLogin: sql<
			string | null
		>`coalesce(${requestTargetGitHubActor.login}, ${gitHubPullRequestReviewerRequestMappings.teamSlug})`,
		externalAvatarUrl: sql<
			string | null
		>`coalesce(${requestTargetGitHubActor.avatarUrl}, ${gitHubPullRequestReviewerRequestMappings.teamAvatarUrl})`,
		externalHtmlUrl: sql<
			string | null
		>`coalesce(${requestTargetGitHubActor.htmlUrl}, ${gitHubPullRequestReviewerRequestMappings.teamHtmlUrl})`,
	},
	requestedBy: {
		userId: pullRequestReviewerRequests.requestedByUserId,
		username: requestedByUser.username,
		externalNodeId: requestedByGitHubActor.externalNodeId,
		externalLogin: requestedByGitHubActor.login,
		externalAvatarUrl: requestedByGitHubActor.avatarUrl,
		externalHtmlUrl: requestedByGitHubActor.htmlUrl,
	},
	createdAt: pullRequestReviewerRequests.createdAt,
}

@Injectable()
export class PullRequestReviewsRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Every review that became public, dismissals included: a dismissed review
	 * keeps its place in the history even though it no longer counts towards the
	 * pull request's state.
	 */
	async listReviewHistory({
		pullRequestId,
	}: PullRequestParams): Promise<PullRequestReviewReadModel[]> {
		return await this.reviewQuery(this.db)
			.where(
				and(
					eq(pullRequestReviews.pullRequestId, pullRequestId),
					inArray(pullRequestReviews.state, ['submitted', 'dismissed'])
				)
			)
			.orderBy(asc(pullRequestReviews.submittedAt), asc(pullRequestReviews.id))
	}

	async listActiveReviewerRequests({
		pullRequestId,
	}: PullRequestParams): Promise<PullRequestReviewerRequestReadModel[]> {
		return await this.reviewerRequestQuery(this.db)
			.where(
				and(
					eq(pullRequestReviewerRequests.pullRequestId, pullRequestId),
					isNull(pullRequestReviewerRequests.removedAt),
					isNull(pullRequestReviewerRequests.fulfilledByReviewId)
				)
			)
			.orderBy(asc(pullRequestReviewerRequests.createdAt))
	}

	async findPendingReview({
		pullRequestId,
		reviewerUserId,
	}: ReviewerParams): Promise<PullRequestPendingReviewReadModel | undefined> {
		const [review] = await this.db
			.select({
				id: pullRequestReviews.id,
				headSha: pullRequestReviews.headSha,
				commentCount: sql<number>`count(${pullRequestComments.id})::int`,
			})
			.from(pullRequestReviews)
			.leftJoin(
				pullRequestComments,
				eq(pullRequestComments.reviewId, pullRequestReviews.id)
			)
			.where(
				and(
					eq(pullRequestReviews.pullRequestId, pullRequestId),
					eq(pullRequestReviews.reviewerUserId, reviewerUserId),
					eq(pullRequestReviews.state, 'pending')
				)
			)
			.groupBy(pullRequestReviews.id, pullRequestReviews.headSha)
			.limit(1)

		return review
	}

	/**
	 * Latest submitted review per reviewer for every requested pull request, with
	 * the pull request author excluded. Batched so list views never query per row.
	 *
	 * Dismissed reviews are left out: the state is `submitted` only until GitHub
	 * dismisses it, and a dismissed verdict must stop counting.
	 */
	async listEffectiveReviews(
		pullRequestIds: PullRequestId[]
	): Promise<PullRequestEffectiveReviewRow[]> {
		if (pullRequestIds.length === 0) return []

		return await this.db
			.selectDistinctOn(
				[pullRequestReviews.pullRequestId, EFFECTIVE_REVIEWER_KEY],
				{
					pullRequestId: pullRequestReviews.pullRequestId,
					reviewer: {
						userId: pullRequestReviews.reviewerUserId,
						username: reviewerUser.username,
						externalNodeId: reviewerGitHubActor.externalNodeId,
						externalLogin: reviewerGitHubActor.login,
						externalAvatarUrl: reviewerGitHubActor.avatarUrl,
						externalHtmlUrl: reviewerGitHubActor.htmlUrl,
					},
					outcome: pullRequestReviews.outcome,
					headSha: pullRequestReviews.headSha,
				}
			)
			.from(pullRequestReviews)
			.innerJoin(
				pullRequests,
				eq(pullRequests.id, pullRequestReviews.pullRequestId)
			)
			.leftJoin(
				reviewerUser,
				eq(reviewerUser.id, pullRequestReviews.reviewerUserId)
			)
			.leftJoin(
				gitHubPullRequestReviewMappings,
				eq(
					gitHubPullRequestReviewMappings.pullRequestReviewId,
					pullRequestReviews.id
				)
			)
			.leftJoin(
				reviewerGitHubActor,
				eq(
					reviewerGitHubActor.id,
					gitHubPullRequestReviewMappings.reviewerActorId
				)
			)
			.leftJoin(
				gitHubPullRequestMappings,
				eq(gitHubPullRequestMappings.pullRequestId, pullRequests.id)
			)
			.where(
				and(
					inArray(pullRequestReviews.pullRequestId, pullRequestIds),
					eq(pullRequestReviews.state, 'submitted'),
					isNotSameActor(
						pullRequestReviews.reviewerUserId,
						pullRequests.authorUserId
					),
					isNotSameActor(
						gitHubPullRequestReviewMappings.reviewerActorId,
						gitHubPullRequestMappings.authorActorId
					)
				)
			)
			.orderBy(
				pullRequestReviews.pullRequestId,
				EFFECTIVE_REVIEWER_KEY,
				desc(pullRequestReviews.submittedAt),
				desc(pullRequestReviews.id)
			)
	}

	async countActiveReviewerRequests(
		pullRequestIds: PullRequestId[]
	): Promise<PullRequestReviewerRequestCountRow[]> {
		if (pullRequestIds.length === 0) return []

		return await this.db
			.select({
				pullRequestId: pullRequestReviewerRequests.pullRequestId,
				requestedCount: count(),
			})
			.from(pullRequestReviewerRequests)
			.where(
				and(
					inArray(pullRequestReviewerRequests.pullRequestId, pullRequestIds),
					isNull(pullRequestReviewerRequests.removedAt),
					isNull(pullRequestReviewerRequests.fulfilledByReviewId)
				)
			)
			.groupBy(pullRequestReviewerRequests.pullRequestId)
	}

	/**
	 * Starts or reuses the reviewer's single pending review. The stored head SHA
	 * belongs to the review, so joining an existing pending review keeps the SHA
	 * the reviewer started from. Undefined when the pull request is no longer
	 * open, which the pull request row lock settles against a concurrent close.
	 */
	async getOrCreatePendingReview({
		headSha,
		pullRequestId,
		reviewerUserId,
	}: GetOrCreatePendingReviewParams): Promise<PullRequestReviewId | undefined> {
		return await this.db.transaction(async tx => {
			const openPullRequest = await this.lockOpenPullRequest(tx, pullRequestId)

			if (!openPullRequest) return undefined

			return await this.getOrCreatePendingReviewIn(tx, {
				headSha,
				pullRequestId,
				reviewerUserId,
			})
		})
	}

	/**
	 * Requests a reviewer under the pull request row lock. The partial unique
	 * index only covers requests that are neither removed nor fulfilled, so a
	 * conflict means the reviewer is currently requested — and the same reviewer
	 * can be asked again once an earlier request is removed or fulfilled.
	 */
	async createReviewerRequest({
		pullRequestId,
		requestedByUserId,
		reviewerUserId,
		reviewerUsername,
	}: CreateReviewerRequestParams): Promise<PullRequestReviewerRequestResult> {
		return await this.db.transaction(async tx => {
			const openPullRequest = await this.lockOpenPullRequest(tx, pullRequestId)

			if (!openPullRequest) return { status: 'pull_request_closed' }

			const [request] = await tx
				.insert(pullRequestReviewerRequests)
				.values({ pullRequestId, reviewerUserId, requestedByUserId })
				.onConflictDoNothing()
				.returning({ id: pullRequestReviewerRequests.id })

			if (!request) return { status: 'already_requested' }

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId: requestedByUserId,
				type: 'review_requested',
				payload: { reviewerUserId, reviewerUsername },
			})

			const createdRequest = await this.findReviewerRequestIn(tx, request.id)

			if (!createdRequest)
				throw new Error(
					'pull request reviewer request is missing after creation'
				)

			return { status: 'created', request: createdRequest }
		})
	}

	async removeReviewerRequest({
		pullRequestId,
		removedAt,
		removedByUserId,
		reviewerUserId,
		reviewerUsername,
	}: RemoveReviewerRequestParams): Promise<boolean> {
		return await this.db.transaction(async tx => {
			const openPullRequest = await this.lockOpenPullRequest(tx, pullRequestId)

			if (!openPullRequest) return false

			const [request] = await tx
				.update(pullRequestReviewerRequests)
				.set({ removedAt, removedByUserId })
				.where(
					and(
						eq(pullRequestReviewerRequests.pullRequestId, pullRequestId),
						eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
						isNull(pullRequestReviewerRequests.removedAt),
						isNull(pullRequestReviewerRequests.fulfilledByReviewId)
					)
				)
				.returning({ id: pullRequestReviewerRequests.id })

			if (!request) return false

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId: removedByUserId,
				type: 'review_request_removed',
				payload: { reviewerUserId, reviewerUsername },
			})

			return true
		})
	}

	/**
	 * Seals the reviewer's envelope: the pending review becomes submitted, its
	 * draft comments become visible, any active request is fulfilled and the
	 * timeline event is written, all in one transaction.
	 *
	 * The submission is bound to the pending review the caller saw. Losing the
	 * conditional update means somebody already sealed that envelope, and the
	 * loser reports a conflict rather than opening a second review.
	 *
	 * A direct submission has no envelope to bind to, so it is made idempotent
	 * instead: a retry that repeats the reviewer's latest submission verbatim is
	 * answered with that review.
	 */
	async submitReview({
		body,
		headSha,
		outcome,
		pendingReviewId,
		pullRequestId,
		reviewerUserId,
		submittedAt,
	}: SubmitReviewParams): Promise<PullRequestReviewSubmissionResult> {
		return await this.db.transaction(async tx => {
			const openPullRequest = await this.lockOpenPullRequest(tx, pullRequestId)

			if (!openPullRequest) return { status: 'pull_request_closed' }

			const submission = { state: 'submitted' as const, outcome, body, headSha }

			if (!pendingReviewId) {
				const repeatedReview = await this.findRepeatedSubmissionIn(tx, {
					body,
					headSha,
					outcome,
					pullRequestId,
					reviewerUserId,
				})

				if (repeatedReview)
					return { status: 'submitted', review: repeatedReview }
			}

			const reviewId = pendingReviewId
				? await this.sealPendingReviewIn(tx, {
						...submission,
						pendingReviewId,
						submittedAt,
					})
				: await this.insertSubmittedReviewIn(tx, {
						...submission,
						pullRequestId,
						reviewerUserId,
						submittedAt,
					})

			if (!reviewId) return { status: 'pending_review_conflict' }

			await tx
				.update(pullRequestComments)
				.set({ state: 'published' })
				.where(
					and(
						eq(pullRequestComments.reviewId, reviewId),
						eq(pullRequestComments.state, 'pending')
					)
				)

			await tx
				.update(pullRequestReviewerRequests)
				.set({ fulfilledByReviewId: reviewId })
				.where(
					and(
						eq(pullRequestReviewerRequests.pullRequestId, pullRequestId),
						eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
						isNull(pullRequestReviewerRequests.removedAt),
						isNull(pullRequestReviewerRequests.fulfilledByReviewId)
					)
				)

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId: reviewerUserId,
				type: 'review_submitted',
				payload: { reviewId, outcome, headSha },
			})

			const review = await this.findSubmittedReviewIn(tx, reviewId)

			if (!review)
				throw new Error('pull request review is missing after submission')

			return { status: 'submitted', review }
		})
	}

	/**
	 * Drops the pending review with its draft comments, and the threads those
	 * comments left empty. No event: an unsubmitted review never became public.
	 */
	async discardPendingReview({
		pullRequestId,
		reviewerUserId,
	}: ReviewerParams): Promise<boolean> {
		return await this.db.transaction(async tx => {
			const openPullRequest = await this.lockOpenPullRequest(tx, pullRequestId)

			if (!openPullRequest) return false

			const [review] = await tx
				.select({ id: pullRequestReviews.id })
				.from(pullRequestReviews)
				.where(
					and(
						eq(pullRequestReviews.pullRequestId, pullRequestId),
						eq(pullRequestReviews.reviewerUserId, reviewerUserId),
						eq(pullRequestReviews.state, 'pending')
					)
				)
				.limit(1)
				.for('update')

			if (!review) return false

			const threadIds = await this.lockDraftCommentThreadsIn(tx, review.id)

			await tx
				.delete(pullRequestComments)
				.where(eq(pullRequestComments.reviewId, review.id))

			if (threadIds.length > 0) {
				const remainingComments = await tx
					.select({ threadId: pullRequestComments.threadId })
					.from(pullRequestComments)
					.where(inArray(pullRequestComments.threadId, threadIds))
				const populatedThreadIds = new Set(
					remainingComments.map(comment => comment.threadId)
				)
				const emptyThreadIds = threadIds.filter(
					threadId => !populatedThreadIds.has(threadId)
				)

				if (emptyThreadIds.length > 0)
					await tx
						.delete(pullRequestThreads)
						.where(inArray(pullRequestThreads.id, emptyThreadIds))
			}

			await tx
				.delete(pullRequestReviews)
				.where(eq(pullRequestReviews.id, review.id))

			return true
		})
	}

	/**
	 * Takes the thread locks the discard needs, lowest id first, before any draft
	 * comment is deleted. Deleting a single comment locks its thread and only
	 * then touches the comment, so sharing that order — thread rows first, in a
	 * deterministic sequence — keeps the two paths from deadlocking each other.
	 */
	private async lockDraftCommentThreadsIn(
		tx: DrizzleTransaction,
		reviewId: PullRequestReviewId
	): Promise<PullRequestThreadId[]> {
		const draftComments = await tx
			.select({ threadId: pullRequestComments.threadId })
			.from(pullRequestComments)
			.where(eq(pullRequestComments.reviewId, reviewId))
		const threadIds = [
			...new Set(draftComments.map(comment => comment.threadId)),
		]

		if (threadIds.length === 0) return []

		const threads = await tx
			.select({ id: pullRequestThreads.id })
			.from(pullRequestThreads)
			.where(inArray(pullRequestThreads.id, threadIds))
			.orderBy(asc(pullRequestThreads.id))
			.for('update')

		return threads.map(thread => thread.id)
	}

	/**
	 * Reviews with their actor, wherever that actor lives. A native review joins
	 * its Tessera account; a synchronized one reaches its GitHub actor through the
	 * review mapping, which also carries the link back to github.com.
	 */
	private reviewQuery(db: PullRequestReviewDatabase) {
		return db
			.select(REVIEW_READ_COLUMNS)
			.from(pullRequestReviews)
			.leftJoin(
				reviewerUser,
				eq(reviewerUser.id, pullRequestReviews.reviewerUserId)
			)
			.leftJoin(
				dismissedByUser,
				eq(dismissedByUser.id, pullRequestReviews.dismissedByUserId)
			)
			.leftJoin(
				gitHubPullRequestReviewMappings,
				eq(
					gitHubPullRequestReviewMappings.pullRequestReviewId,
					pullRequestReviews.id
				)
			)
			.leftJoin(
				reviewerGitHubActor,
				eq(
					reviewerGitHubActor.id,
					gitHubPullRequestReviewMappings.reviewerActorId
				)
			)
			.leftJoin(
				dismissedByGitHubActor,
				eq(
					dismissedByGitHubActor.id,
					gitHubPullRequestReviewMappings.dismissedByActorId
				)
			)
	}

	private reviewerRequestQuery(db: PullRequestReviewDatabase) {
		return db
			.select(REVIEWER_REQUEST_READ_COLUMNS)
			.from(pullRequestReviewerRequests)
			.leftJoin(
				reviewerUser,
				eq(reviewerUser.id, pullRequestReviewerRequests.reviewerUserId)
			)
			.leftJoin(
				requestedByUser,
				eq(requestedByUser.id, pullRequestReviewerRequests.requestedByUserId)
			)
			.leftJoin(
				gitHubPullRequestReviewerRequestMappings,
				eq(
					gitHubPullRequestReviewerRequestMappings.pullRequestReviewerRequestId,
					pullRequestReviewerRequests.id
				)
			)
			.leftJoin(
				requestTargetGitHubActor,
				eq(
					requestTargetGitHubActor.id,
					gitHubPullRequestReviewerRequestMappings.targetActorId
				)
			)
			.leftJoin(
				requestedByGitHubActor,
				eq(
					requestedByGitHubActor.id,
					gitHubPullRequestReviewerRequestMappings.requestedByActorId
				)
			)
	}

	private async findReviewerRequestIn(
		tx: DrizzleTransaction,
		requestId: PullRequestReviewerRequestId
	): Promise<PullRequestReviewerRequestReadModel | undefined> {
		const [request] = await this.reviewerRequestQuery(tx)
			.where(eq(pullRequestReviewerRequests.id, requestId))
			.limit(1)

		return request
	}

	private async findSubmittedReviewIn(
		tx: DrizzleTransaction,
		reviewId: PullRequestReviewId
	): Promise<PullRequestReviewReadModel | undefined> {
		const [review] = await this.reviewQuery(tx)
			.where(eq(pullRequestReviews.id, reviewId))
			.limit(1)

		return review
	}

	/**
	 * The reviewer's latest submission when it repeats the incoming one exactly.
	 * A lost response leaves the client retrying a submission that already
	 * landed, and only an identical outcome, head, and body can be that retry —
	 * anything else is a new opinion and deserves its own review.
	 */
	private async findRepeatedSubmissionIn(
		tx: DrizzleTransaction,
		{
			body,
			headSha,
			outcome,
			pullRequestId,
			reviewerUserId,
		}: {
			body: string
			headSha: string
			outcome: PullRequestReviewOutcome
			pullRequestId: PullRequestId
			reviewerUserId: UserId
		}
	): Promise<PullRequestReviewReadModel | undefined> {
		const [latestReview] = await this.reviewQuery(tx)
			.where(
				and(
					eq(pullRequestReviews.pullRequestId, pullRequestId),
					eq(pullRequestReviews.reviewerUserId, reviewerUserId),
					eq(pullRequestReviews.state, 'submitted')
				)
			)
			.orderBy(
				desc(pullRequestReviews.submittedAt),
				desc(pullRequestReviews.id)
			)
			.limit(1)

		if (!latestReview) return undefined

		const isRepeat =
			latestReview.outcome === outcome &&
			latestReview.headSha === headSha &&
			latestReview.body === body

		return isRepeat ? latestReview : undefined
	}

	private async sealPendingReviewIn(
		tx: DrizzleTransaction,
		{
			pendingReviewId,
			...submission
		}: {
			body: string
			headSha: string
			outcome: PullRequestReviewOutcome
			pendingReviewId: PullRequestReviewId
			state: 'submitted'
			submittedAt: Date
		}
	): Promise<PullRequestReviewId | undefined> {
		const [review] = await tx
			.update(pullRequestReviews)
			.set(submission)
			.where(
				and(
					eq(pullRequestReviews.id, pendingReviewId),
					eq(pullRequestReviews.state, 'pending')
				)
			)
			.returning({ id: pullRequestReviews.id })

		return review?.id
	}

	/** Direct submission: a reviewer with nothing batched reviews in one step. */
	private async insertSubmittedReviewIn(
		tx: DrizzleTransaction,
		submission: {
			body: string
			headSha: string
			outcome: PullRequestReviewOutcome
			pullRequestId: PullRequestId
			reviewerUserId: UserId
			state: 'submitted'
			submittedAt: Date
		}
	): Promise<PullRequestReviewId> {
		const [review] = await tx
			.insert(pullRequestReviews)
			.values(submission)
			.returning({ id: pullRequestReviews.id })

		if (!review) throw new Error('failed to submit pull request review')

		return review.id
	}

	private async getOrCreatePendingReviewIn(
		tx: DrizzleTransaction,
		{ headSha, pullRequestId, reviewerUserId }: GetOrCreatePendingReviewParams
	): Promise<PullRequestReviewId> {
		const existingReview = await this.findPendingReviewIn(tx, {
			pullRequestId,
			reviewerUserId,
		})

		if (existingReview) return existingReview

		const [review] = await tx
			.insert(pullRequestReviews)
			.values({ pullRequestId, reviewerUserId, headSha, state: 'pending' })
			.onConflictDoNothing()
			.returning({ id: pullRequestReviews.id })

		if (review) return review.id

		const concurrentReview = await this.findPendingReviewIn(tx, {
			pullRequestId,
			reviewerUserId,
		})

		if (!concurrentReview)
			throw new Error('failed to create pending pull request review')

		return concurrentReview
	}

	private async findPendingReviewIn(
		tx: DrizzleTransaction,
		{ pullRequestId, reviewerUserId }: ReviewerParams
	): Promise<PullRequestReviewId | undefined> {
		const [review] = await tx
			.select({ id: pullRequestReviews.id })
			.from(pullRequestReviews)
			.where(
				and(
					eq(pullRequestReviews.pullRequestId, pullRequestId),
					eq(pullRequestReviews.reviewerUserId, reviewerUserId),
					eq(pullRequestReviews.state, 'pending')
				)
			)
			.limit(1)

		return review?.id
	}

	private async lockOpenPullRequest(
		tx: DrizzleTransaction,
		pullRequestId: PullRequestId
	) {
		const [pullRequest] = await tx
			.select({ id: pullRequests.id, state: pullRequests.state })
			.from(pullRequests)
			.where(eq(pullRequests.id, pullRequestId))
			.for('update')

		return pullRequest?.state === 'open' ? pullRequest : undefined
	}

	private async createEvent(
		db: PullRequestReviewDatabase,
		params: {
			actorUserId: UserId
			payload: PullRequestEventPayload
			pullRequestId: PullRequestId
			type: PullRequestEvent['type']
		}
	) {
		await db.insert(pullRequestEvents).values(params)
	}
}

/**
 * Two identities are the same person only when both sides are known and equal.
 * `is distinct from` would call a pair of nulls a match, which would drop every
 * review whose reviewer and author are unattributed on the same side.
 */
function isNotSameActor(left: PgColumn, right: PgColumn) {
	return sql`(${left} is null or ${right} is null or ${left} <> ${right})`
}
