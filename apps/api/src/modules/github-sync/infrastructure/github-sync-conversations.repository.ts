import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type {
	DrizzleTransaction,
	GitHubActorId,
	GitHubPullRequestMappingId,
	GitHubPullRequestReviewerRequestMappingId,
	GitHubPullRequestReviewMappingId,
	GitHubPullRequestThreadMappingId,
	GitHubWebhookDeliveryId,
	NewGitHubPullRequestCommentMapping,
	NewGitHubPullRequestReviewMapping,
	NewGitHubPullRequestThreadMapping,
	PullRequestEventPayload,
} from '@repo/db'
import {
	and,
	asc,
	count,
	eq,
	gitHubActors,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	gitHubPullRequestReviewerRequestMappings,
	gitHubPullRequestReviewMappings,
	gitHubPullRequestThreadMappings,
	inArray,
	isNull,
	lt,
	or,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequestThreads,
	sql,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import type { GitHubGroupedReviewThread } from '../helpers/github-pull-request-conversation'
import type {
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncIssueComment,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewerRequestTarget,
} from './github-sync.client.types'
import type {
	GitHubConversationTarget,
	GitHubPendingConversationDelivery,
} from './github-sync.repository'
import { assertGitHubSyncAuthority } from './github-sync-authority'

export interface GitHubConversationAnchor {
	path: string
	side: 'left' | 'right'
	line: number
	anchorSha: string
	baseSha: string
	headSha: string
	lineExcerpt: string
}

export interface GitHubConversationThreadProjection {
	thread: GitHubGroupedReviewThread
	/** Absent when the native model cannot hold the anchor faithfully. */
	anchor?: GitHubConversationAnchor
	/** Absent when GraphQL did not return the thread: unknown, not current. */
	providerOutdated?: boolean
}

export interface ProjectPullRequestConversationParams {
	actorIds: Map<string, GitHubActorId>
	authorityGeneration: number
	conversation: GitHubPullRequestConversation
	deliveries: GitHubPendingConversationDelivery[]
	leaseOwner: string
	/** Replies whose root this snapshot does not contain. */
	orphanedComments: GitHubSyncReviewComment[]
	repositoryId: RepositoryId
	syncedAt: Date
	syncVersion: number
	target: GitHubConversationTarget
	threads: GitHubConversationThreadProjection[]
}

interface ProjectionContext extends ProjectPullRequestConversationParams {
	commentNodeIdsByNumericId: Map<bigint, string>
	reviewIdsByNumericId: Map<bigint, PullRequestReviewId>
	reviewNodeIdsByNumericId: Map<bigint, string>
	transaction: DrizzleTransaction
	userIdsByActorId: Map<GitHubActorId, UserId>
}

interface GitHubThreadMappingState {
	id: GitHubPullRequestThreadMappingId
	lastSeenSyncVersion: number
	pullRequestThreadId: PullRequestThreadId | null
	deliveryId: GitHubWebhookDeliveryId | null
	providerOutdated: boolean
	providerResolved: boolean
	providerResolvedAt: Date | null
	resolvedByActorId: GitHubActorId | null
}

interface GitHubThreadResolution {
	actorId?: GitHubActorId
	delivery?: GitHubPendingConversationDelivery
	/** False when GraphQL did not return the thread, so nothing was observed. */
	isObserved: boolean
	resolved: boolean
	resolvedAt?: Date
}

interface CommentProjectionParams {
	authorActorId: GitHubActorId
	body: string
	createdAt: Date
	externalNodeId: string
	externalNumericId: bigint
	htmlUrl: string
	kind: 'issue' | 'review'
	reviewComment?: GitHubSyncReviewComment
	threadId?: PullRequestThreadId
	threadMappingId?: GitHubPullRequestThreadMappingId
	updatedAt: Date
}

@Injectable()
export class GitHubSyncConversationsRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Projects one pull request's complete GitHub conversation. Everything lands
	 * in a single transaction behind the authority fence, so a mirror that lost
	 * its lease mid-projection leaves no half-written conversation behind.
	 */
	async projectPullRequestConversation(
		params: ProjectPullRequestConversationParams
	): Promise<void> {
		await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${params.target.externalNodeId}, 0))`
			)
			await assertGitHubSyncAuthority(transaction, params)

			const context: ProjectionContext = {
				...params,
				commentNodeIdsByNumericId: new Map(
					params.conversation.reviewComments.map(comment => [
						comment.numericId,
						comment.nodeId,
					])
				),
				reviewIdsByNumericId: new Map(),
				reviewNodeIdsByNumericId: new Map(
					params.conversation.reviews.map(review => [
						review.numericId,
						review.nodeId,
					])
				),
				transaction,
				userIdsByActorId: await this.findActorUserIds(
					transaction,
					params.actorIds
				),
			}

			await this.projectReviews(context)
			await this.projectReviewThreads(context)
			await this.projectOrphanedComments(context)
			await this.projectIssueComments(context)
			await this.projectReviewerRequests(context)
			await this.tombstoneAbsentResources(context)

			await transaction
				.update(gitHubPullRequestMappings)
				.set({ conversationSyncedAt: params.syncedAt })
				.where(
					eq(gitHubPullRequestMappings.id, params.target.pullRequestMappingId)
				)
		})
	}

	private async findActorUserIds(
		transaction: DrizzleTransaction,
		actorIds: Map<string, GitHubActorId>
	): Promise<Map<GitHubActorId, UserId>> {
		const ids = [...actorIds.values()]
		if (ids.length === 0) return new Map()

		const rows = await transaction
			.select({ id: gitHubActors.id, userId: gitHubActors.userId })
			.from(gitHubActors)
			.where(inArray(gitHubActors.id, ids))

		return new Map(
			rows.flatMap(row => (row.userId ? [[row.id, row.userId] as const] : []))
		)
	}

	private async projectReviews(context: ProjectionContext): Promise<void> {
		for (const review of context.conversation.reviews)
			await this.projectReview(context, review)
	}

	/**
	 * GitHub stops reporting the outcome of a review once it is dismissed, so a
	 * dismissal keeps whatever decision Tessera already recorded. A review first
	 * seen in that state has no recoverable decision and is projected without one
	 * rather than inventing a verdict nobody gave.
	 */
	private async projectReview(
		context: ProjectionContext,
		review: GitHubSyncReview
	): Promise<void> {
		const { syncedAt, syncVersion, target, transaction } = context
		const reviewerActorId = requireActorId(context, review.reviewer)
		const [existingMapping] = await transaction
			.select({
				id: gitHubPullRequestReviewMappings.id,
				pullRequestReviewId:
					gitHubPullRequestReviewMappings.pullRequestReviewId,
				providerDismissedAt:
					gitHubPullRequestReviewMappings.providerDismissedAt,
				lastSeenSyncVersion:
					gitHubPullRequestReviewMappings.lastSeenSyncVersion,
			})
			.from(gitHubPullRequestReviewMappings)
			.where(eq(gitHubPullRequestReviewMappings.externalNodeId, review.nodeId))
			.limit(1)

		if (isNewerThanSnapshot(existingMapping, syncVersion)) return

		const storedReview = existingMapping?.pullRequestReviewId
			? await this.findNativeReview(
					transaction,
					existingMapping.pullRequestReviewId
				)
			: undefined
		const outcome = review.outcome ?? storedReview?.outcome ?? undefined
		const dismissal = review.dismissed
			? this.findDelivery(context, {
					action: 'dismissed',
					eventName: 'pull_request_review',
					externalNodeId: review.nodeId,
					externalNumericId: review.numericId,
				})
			: undefined
		const dismissedAt = review.dismissed
			? (existingMapping?.providerDismissedAt ??
				dismissal?.receivedAt ??
				syncedAt)
			: undefined
		const reviewId =
			outcome || review.dismissed
				? await this.upsertNativeReview(context, {
						dismissal,
						dismissedAt,
						outcome,
						review,
						reviewerActorId,
						reviewId: existingMapping?.pullRequestReviewId ?? undefined,
					})
				: undefined

		if (reviewId) context.reviewIdsByNumericId.set(review.numericId, reviewId)

		await this.upsertReviewMapping(context, existingMapping?.id, {
			pullRequestMappingId: target.pullRequestMappingId,
			pullRequestReviewId: reviewId ?? null,
			externalNodeId: review.nodeId,
			externalNumericId: review.numericId,
			reviewerActorId,
			htmlUrl: review.htmlUrl,
			commitId: review.commitId,
			dismissedByActorId: dismissedAt ? (dismissal?.actorId ?? null) : null,
			providerSubmittedAt: review.submittedAt,
			providerDismissedAt: dismissedAt ?? null,
			providerDeletedAt: null,
			deliveryId: dismissal?.deliveryId ?? null,
			lastSeenSyncVersion: syncVersion,
		})

		if (!reviewId) return

		const payload = {
			reviewId,
			outcome,
			headSha: review.commitId ?? target.headSha,
		}

		await this.createGitHubEvent(context, {
			actorId: reviewerActorId,
			createdAt: review.submittedAt,
			externalKey: `${review.nodeId}:review_submitted`,
			payload,
			type: 'review_submitted',
		})

		// GitHub never names a dismisser outside the webhook, and attributing the
		// dismissal to the reviewer would be a lie, so a reconciled-only dismissal
		// changes state without claiming an author.
		if (!(dismissedAt && dismissal?.actorId)) return
		if (storedReview?.state === 'dismissed') return

		await this.createGitHubEvent(context, {
			actorId: dismissal.actorId,
			createdAt: dismissedAt,
			deliveryId: dismissal.deliveryId,
			externalKey: `${review.nodeId}:review_dismissed:${dismissedAt.toISOString()}`,
			payload,
			type: 'review_dismissed',
		})
	}

	private async upsertReviewMapping(
		{ transaction }: ProjectionContext,
		mappingId: GitHubPullRequestReviewMappingId | undefined,
		values: NewGitHubPullRequestReviewMapping
	): Promise<void> {
		if (mappingId) {
			await transaction
				.update(gitHubPullRequestReviewMappings)
				.set(values)
				.where(eq(gitHubPullRequestReviewMappings.id, mappingId))

			return
		}

		await transaction.insert(gitHubPullRequestReviewMappings).values(values)
	}

	private async upsertNativeReview(
		{ target, transaction, userIdsByActorId }: ProjectionContext,
		{
			dismissal,
			dismissedAt,
			outcome,
			review,
			reviewerActorId,
			reviewId,
		}: {
			dismissal?: GitHubPendingConversationDelivery
			dismissedAt?: Date
			outcome?: 'approve' | 'request_changes' | 'comment'
			review: GitHubSyncReview
			reviewerActorId: GitHubActorId
			reviewId?: PullRequestReviewId
		}
	): Promise<PullRequestReviewId> {
		const values = {
			pullRequestId: target.pullRequestId,
			provider: 'github' as const,
			reviewerUserId: userIdsByActorId.get(reviewerActorId) ?? null,
			state: review.dismissed ? ('dismissed' as const) : ('submitted' as const),
			outcome: outcome ?? null,
			headSha: review.commitId ?? target.headSha,
			body: review.body,
			createdAt: review.submittedAt,
			submittedAt: review.submittedAt,
			dismissedAt: dismissedAt ?? null,
			dismissedByUserId: dismissal?.actorId
				? (userIdsByActorId.get(dismissal.actorId) ?? null)
				: null,
		}

		if (reviewId) {
			await transaction
				.update(pullRequestReviews)
				.set(values)
				.where(eq(pullRequestReviews.id, reviewId))

			return reviewId
		}

		const [createdReview] = await transaction
			.insert(pullRequestReviews)
			.values(values)
			.returning({ id: pullRequestReviews.id })

		if (!createdReview)
			throw new Error('failed to create synchronized GitHub review')

		return createdReview.id
	}

	private async findNativeReview(
		transaction: DrizzleTransaction,
		reviewId: PullRequestReviewId
	) {
		const [review] = await transaction
			.select({
				outcome: pullRequestReviews.outcome,
				state: pullRequestReviews.state,
			})
			.from(pullRequestReviews)
			.where(eq(pullRequestReviews.id, reviewId))
			.limit(1)

		return review
	}

	private async projectReviewThreads(
		context: ProjectionContext
	): Promise<void> {
		for (const projection of context.threads)
			await this.projectReviewThread(context, projection)
	}

	private async projectReviewThread(
		context: ProjectionContext,
		{ anchor, providerOutdated, thread }: GitHubConversationThreadProjection
	): Promise<void> {
		const { syncVersion, target, transaction } = context
		const existingMapping = await this.findThreadMapping(transaction, {
			externalNodeId: thread.externalNodeId,
			pullRequestMappingId: target.pullRequestMappingId,
			rootCommentNodeId: thread.rootCommentNodeId,
		})
		if (isNewerThanSnapshot(existingMapping, syncVersion)) {
			await this.projectThreadComments(context, thread, {
				threadId: existingMapping?.pullRequestThreadId ?? undefined,
				threadMappingId: existingMapping?.id,
			})

			return
		}

		const resolution = this.readThreadResolution(context, {
			existingMapping,
			thread,
		})
		const threadId = anchor
			? await this.upsertNativeThread(context, {
					anchor,
					createdAt: thread.root.createdAt,
					resolvedAt: resolution.resolvedAt,
					resolvedByActorId: resolution.actorId,
					threadId: existingMapping?.pullRequestThreadId ?? undefined,
				})
			: (existingMapping?.pullRequestThreadId ?? undefined)
		const threadMappingId = await this.upsertThreadMapping(
			context,
			existingMapping?.id,
			{
				pullRequestMappingId: target.pullRequestMappingId,
				pullRequestThreadId: threadId ?? null,
				externalNodeId: thread.externalNodeId,
				rootCommentNodeId: thread.rootCommentNodeId,
				providerOutdated:
					providerOutdated ?? existingMapping?.providerOutdated ?? false,
				...toThreadResolutionColumns(
					existingMapping,
					resolution,
					Boolean(threadId)
				),
				lastSeenSyncVersion: syncVersion,
				deletedAt: null,
			}
		)

		await this.projectThreadComments(context, thread, {
			threadId,
			threadMappingId,
		})

		if (!(existingMapping && threadId && resolution.isObserved)) return
		if (existingMapping.providerResolved === resolution.resolved) return

		await this.createThreadResolutionEvent(context, {
			actorId: resolution.actorId ?? resolution.delivery?.actorId,
			createdAt:
				resolution.resolvedAt ??
				resolution.delivery?.receivedAt ??
				context.syncedAt,
			deliveryId: resolution.delivery?.deliveryId,
			resolved: resolution.resolved,
			threadId,
			threadNodeId: thread.externalNodeId ?? thread.rootCommentNodeId,
		})
	}

	private async projectThreadComments(
		context: ProjectionContext,
		thread: GitHubGroupedReviewThread,
		{
			threadId,
			threadMappingId,
		}: {
			threadId?: PullRequestThreadId
			threadMappingId?: GitHubPullRequestThreadMappingId
		}
	): Promise<void> {
		for (const comment of thread.comments)
			await this.projectComment(context, {
				authorActorId: requireActorId(context, comment.author),
				body: comment.body,
				createdAt: comment.createdAt,
				externalNodeId: comment.nodeId,
				externalNumericId: comment.numericId,
				htmlUrl: comment.htmlUrl,
				kind: 'review',
				reviewComment: comment,
				threadId,
				threadMappingId,
				updatedAt: comment.updatedAt,
			})
	}

	/**
	 * GraphQL is the only source of resolution, so a thread it did not return
	 * keeps the state Tessera already knew: reading its absence as "unresolved"
	 * would clear resolutions nobody touched. GitHub also reports that a thread is
	 * resolved but never when, so a webhook timestamp is preferred and the
	 * observation time is the honest fallback.
	 */
	private readThreadResolution(
		context: ProjectionContext,
		{
			existingMapping,
			thread,
		}: {
			existingMapping?: GitHubThreadMappingState
			thread: GitHubGroupedReviewThread
		}
	): GitHubThreadResolution {
		const resolved =
			thread.resolved ?? existingMapping?.providerResolved ?? false

		if (thread.resolved === undefined)
			return {
				actorId: existingMapping?.resolvedByActorId ?? undefined,
				isObserved: false,
				resolved,
				resolvedAt: existingMapping?.providerResolvedAt ?? undefined,
			}

		const delivery = this.findDelivery(context, {
			action: resolved ? 'resolved' : 'unresolved',
			eventName: 'pull_request_review_thread',
			externalNodeId: thread.externalNodeId,
		})

		return {
			actorId: thread.resolvedBy
				? requireActorId(context, thread.resolvedBy)
				: undefined,
			delivery,
			isObserved: true,
			resolved,
			resolvedAt: resolved
				? (existingMapping?.providerResolvedAt ??
					delivery?.receivedAt ??
					context.syncedAt)
				: undefined,
		}
	}

	private async upsertThreadMapping(
		{ transaction }: ProjectionContext,
		mappingId: GitHubPullRequestThreadMappingId | undefined,
		values: NewGitHubPullRequestThreadMapping
	): Promise<GitHubPullRequestThreadMappingId> {
		if (mappingId) {
			await transaction
				.update(gitHubPullRequestThreadMappings)
				.set(values)
				.where(eq(gitHubPullRequestThreadMappings.id, mappingId))

			return mappingId
		}

		const [createdMapping] = await transaction
			.insert(gitHubPullRequestThreadMappings)
			.values(values)
			.returning({ id: gitHubPullRequestThreadMappings.id })

		if (!createdMapping)
			throw new Error('failed to map synchronized GitHub review thread')

		return createdMapping.id
	}

	/**
	 * The thread node id is the identity; the root comment id only stands in for
	 * threads GraphQL never named. Both are looked up inside the pull request
	 * first, and a tombstoned mapping is never matched — it kept neither id, and a
	 * thread GitHub deleted must not claim the one that took its place.
	 */
	private async findThreadMapping(
		transaction: DrizzleTransaction,
		{
			externalNodeId,
			pullRequestMappingId,
			rootCommentNodeId,
		}: {
			externalNodeId?: string
			pullRequestMappingId: GitHubPullRequestMappingId
			rootCommentNodeId?: string
		}
	) {
		const identity = or(
			externalNodeId
				? eq(gitHubPullRequestThreadMappings.externalNodeId, externalNodeId)
				: undefined,
			rootCommentNodeId
				? eq(
						gitHubPullRequestThreadMappings.rootCommentNodeId,
						rootCommentNodeId
					)
				: undefined
		)

		if (!identity) return undefined

		const scopes = [
			externalNodeId
				? and(
						eq(
							gitHubPullRequestThreadMappings.pullRequestMappingId,
							pullRequestMappingId
						),
						eq(gitHubPullRequestThreadMappings.externalNodeId, externalNodeId)
					)
				: undefined,
			and(
				eq(
					gitHubPullRequestThreadMappings.pullRequestMappingId,
					pullRequestMappingId
				),
				identity
			),
			// A mapping left under another pull request still owns these node ids in
			// the unique index, so it is adopted and repaired rather than left to
			// abort the whole projection on insert.
			identity,
		]

		for (const scope of scopes) {
			if (!scope) continue

			const [mapping] = await transaction
				.select({
					id: gitHubPullRequestThreadMappings.id,
					pullRequestThreadId:
						gitHubPullRequestThreadMappings.pullRequestThreadId,
					lastSeenSyncVersion:
						gitHubPullRequestThreadMappings.lastSeenSyncVersion,
					deliveryId: gitHubPullRequestThreadMappings.deliveryId,
					providerOutdated: gitHubPullRequestThreadMappings.providerOutdated,
					providerResolved: gitHubPullRequestThreadMappings.providerResolved,
					providerResolvedAt:
						gitHubPullRequestThreadMappings.providerResolvedAt,
					resolvedByActorId: gitHubPullRequestThreadMappings.resolvedByActorId,
				})
				.from(gitHubPullRequestThreadMappings)
				.where(and(scope, isNull(gitHubPullRequestThreadMappings.deletedAt)))
				.orderBy(asc(gitHubPullRequestThreadMappings.createdAt))
				.limit(1)

			if (mapping) return mapping
		}

		return undefined
	}

	private async upsertNativeThread(
		context: ProjectionContext,
		{
			anchor,
			createdAt,
			resolvedAt,
			resolvedByActorId,
			threadId,
		}: {
			anchor: GitHubConversationAnchor
			createdAt: Date
			resolvedAt?: Date
			resolvedByActorId?: GitHubActorId
			threadId?: PullRequestThreadId
		}
	): Promise<PullRequestThreadId> {
		const values = {
			pullRequestId: context.target.pullRequestId,
			provider: 'github' as const,
			kind: 'inline' as const,
			...anchor,
			createdAt,
			resolvedAt: resolvedAt ?? null,
			// A native thread may only name a resolver while it is resolved, and
			// GraphQL keeps reporting one for a thread that was reopened. The pair is
			// a check constraint, so an ungated resolver wedges every later sync.
			resolvedByUserId:
				resolvedAt && resolvedByActorId
					? (context.userIdsByActorId.get(resolvedByActorId) ?? null)
					: null,
		}

		if (threadId) {
			await context.transaction
				.update(pullRequestThreads)
				.set(values)
				.where(eq(pullRequestThreads.id, threadId))

			return threadId
		}

		const [createdThread] = await context.transaction
			.insert(pullRequestThreads)
			.values(values)
			.returning({ id: pullRequestThreads.id })

		if (!createdThread)
			throw new Error('failed to create synchronized GitHub thread')

		return createdThread.id
	}

	/**
	 * A reply whose root this snapshot is missing keeps its identity and its
	 * last-seen stamp so tombstoning does not mistake it for a deletion; the
	 * next reconciliation attaches it once the root reappears.
	 */
	private async projectOrphanedComments(
		context: ProjectionContext
	): Promise<void> {
		for (const comment of context.orphanedComments)
			await this.projectComment(context, {
				authorActorId: requireActorId(context, comment.author),
				body: comment.body,
				createdAt: comment.createdAt,
				externalNodeId: comment.nodeId,
				externalNumericId: comment.numericId,
				htmlUrl: comment.htmlUrl,
				kind: 'review',
				reviewComment: comment,
				updatedAt: comment.updatedAt,
			})
	}

	/**
	 * GitHub issue comments are flat, so each one becomes its own top-level
	 * thread; folding them together would invent reply semantics and collapse
	 * their place in a timeline ordered by thread creation.
	 */
	private async projectIssueComments(
		context: ProjectionContext
	): Promise<void> {
		for (const comment of context.conversation.issueComments)
			await this.projectIssueComment(context, comment)
	}

	private async projectIssueComment(
		context: ProjectionContext,
		comment: GitHubSyncIssueComment
	): Promise<void> {
		const { syncVersion, target, transaction } = context

		// The thread exists to hold the comment, so a comment GitHub left blank
		// gets none: it would render as an empty conversation Tessera invented.
		// Whatever was projected before is left to the tombstone sweep.
		if (!comment.body.trim()) return

		const existingMapping = await this.findThreadMapping(transaction, {
			pullRequestMappingId: target.pullRequestMappingId,
			rootCommentNodeId: comment.nodeId,
		})
		let threadId = existingMapping?.pullRequestThreadId ?? undefined

		if (!threadId) {
			const [createdThread] = await transaction
				.insert(pullRequestThreads)
				.values({
					pullRequestId: target.pullRequestId,
					provider: 'github',
					kind: 'top_level',
					createdAt: comment.createdAt,
				})
				.returning({ id: pullRequestThreads.id })

			if (!createdThread)
				throw new Error('failed to create synchronized GitHub comment thread')

			threadId = createdThread.id
		}

		const threadMappingId = await this.upsertThreadMapping(
			context,
			existingMapping?.id,
			{
				pullRequestMappingId: target.pullRequestMappingId,
				pullRequestThreadId: threadId,
				rootCommentNodeId: comment.nodeId,
				providerResolved: false,
				providerResolvedAt: null,
				providerOutdated: false,
				lastSeenSyncVersion: syncVersion,
				deletedAt: null,
			}
		)

		await this.projectComment(context, {
			authorActorId: requireActorId(context, comment.author),
			body: comment.body,
			createdAt: comment.createdAt,
			externalNodeId: comment.nodeId,
			externalNumericId: comment.numericId,
			htmlUrl: comment.htmlUrl,
			kind: 'issue',
			threadId,
			threadMappingId,
			updatedAt: comment.updatedAt,
		})
	}

	private async projectComment(
		context: ProjectionContext,
		params: CommentProjectionParams
	): Promise<void> {
		const { transaction } = context

		// A body GitHub cleared leaves nothing to render, so the mapping keeps its
		// older sync stamp and the tombstone sweep takes the native comment with it.
		// Refreshing the stamp here would carry the stale body through every sweep.
		if (!params.body.trim()) return

		const [existingMapping] = await transaction
			.select({
				id: gitHubPullRequestCommentMappings.id,
				pullRequestCommentId:
					gitHubPullRequestCommentMappings.pullRequestCommentId,
				lastSeenSyncVersion:
					gitHubPullRequestCommentMappings.lastSeenSyncVersion,
			})
			.from(gitHubPullRequestCommentMappings)
			.where(
				eq(
					gitHubPullRequestCommentMappings.externalNodeId,
					params.externalNodeId
				)
			)
			.limit(1)

		if (isNewerThanSnapshot(existingMapping, context.syncVersion)) return

		const reviewId = params.reviewComment?.reviewNumericId
			? context.reviewIdsByNumericId.get(params.reviewComment.reviewNumericId)
			: undefined
		const commentId = await this.upsertNativeComment(context, {
			...params,
			commentId: existingMapping?.pullRequestCommentId ?? undefined,
			reviewId,
		})
		const mappingValues = toCommentMappingValues(context, params, commentId)

		if (existingMapping)
			await transaction
				.update(gitHubPullRequestCommentMappings)
				.set(mappingValues)
				.where(eq(gitHubPullRequestCommentMappings.id, existingMapping.id))
		else
			await transaction
				.insert(gitHubPullRequestCommentMappings)
				.values(mappingValues)
	}

	private async upsertNativeComment(
		{ transaction, userIdsByActorId }: ProjectionContext,
		{
			authorActorId,
			body,
			commentId,
			createdAt,
			reviewId,
			threadId,
			updatedAt,
		}: CommentProjectionParams & {
			commentId?: PullRequestCommentId
			reviewId?: PullRequestReviewId
		}
	): Promise<PullRequestCommentId | undefined> {
		// A comment whose thread the native model could not anchor stays a
		// mapping-only record.
		if (!threadId) return commentId

		const editedAt =
			updatedAt.getTime() > createdAt.getTime() ? updatedAt : null

		if (commentId) {
			await transaction
				.update(pullRequestComments)
				.set({ body, editedAt, reviewId: reviewId ?? null, threadId })
				.where(eq(pullRequestComments.id, commentId))

			return commentId
		}

		const [createdComment] = await transaction
			.insert(pullRequestComments)
			.values({
				threadId,
				provider: 'github',
				authorUserId: userIdsByActorId.get(authorActorId) ?? null,
				body,
				state: 'published',
				reviewId,
				createdAt,
				editedAt,
			})
			.returning({ id: pullRequestComments.id })

		if (!createdComment)
			throw new Error('failed to create synchronized GitHub comment')

		return createdComment.id
	}

	/**
	 * GitHub only exposes the reviewers it is still waiting on, so the request set
	 * is reconciled as current state: absent targets are deactivated rather than
	 * deleted, keeping each request occurrence in history.
	 */
	private async projectReviewerRequests(
		context: ProjectionContext
	): Promise<void> {
		const { syncVersion, target, transaction } = context
		const activeMappings = await transaction
			.select({
				id: gitHubPullRequestReviewerRequestMappings.id,
				pullRequestReviewerRequestId:
					gitHubPullRequestReviewerRequestMappings.pullRequestReviewerRequestId,
				lastSeenSyncVersion:
					gitHubPullRequestReviewerRequestMappings.lastSeenSyncVersion,
				targetActorId: gitHubPullRequestReviewerRequestMappings.targetActorId,
				targetKind: gitHubPullRequestReviewerRequestMappings.targetKind,
				targetNodeId: gitHubPullRequestReviewerRequestMappings.targetNodeId,
			})
			.from(gitHubPullRequestReviewerRequestMappings)
			.where(
				and(
					eq(
						gitHubPullRequestReviewerRequestMappings.pullRequestMappingId,
						target.pullRequestMappingId
					),
					eq(gitHubPullRequestReviewerRequestMappings.active, true)
				)
			)
		const seenTargetKeys = new Set<string>()

		for (const requested of context.conversation.requestedReviewers) {
			const targetNodeId = toReviewerTargetNodeId(requested)
			seenTargetKeys.add(`${requested.kind}:${targetNodeId}`)

			const existingMapping = activeMappings.find(
				mapping =>
					mapping.targetKind === requested.kind &&
					mapping.targetNodeId === targetNodeId
			)

			if (existingMapping) {
				if (isNewerThanSnapshot(existingMapping, syncVersion)) continue

				await transaction
					.update(gitHubPullRequestReviewerRequestMappings)
					.set({ lastSeenSyncVersion: syncVersion })
					.where(
						eq(gitHubPullRequestReviewerRequestMappings.id, existingMapping.id)
					)
				continue
			}

			await this.createReviewerRequest(context, requested, targetNodeId)
		}

		for (const mapping of activeMappings)
			if (
				!(
					seenTargetKeys.has(`${mapping.targetKind}:${mapping.targetNodeId}`) ||
					isNewerThanSnapshot(mapping, syncVersion)
				)
			)
				await this.deactivateReviewerRequest(context, mapping)
	}

	private async createReviewerRequest(
		context: ProjectionContext,
		requested: GitHubSyncReviewerRequestTarget,
		targetNodeId: string
	): Promise<void> {
		const { syncVersion, target, transaction } = context
		const targetActorId =
			requested.kind === 'user'
				? requireActorId(context, requested.actor)
				: undefined
		const request = this.findReviewerRequestDelivery(context, {
			action: 'review_requested',
			targetActorId,
			targetNodeId,
		})
		const reviewerUserId = targetActorId
			? (context.userIdsByActorId.get(targetActorId) ?? null)
			: null
		// Only one active request per native reviewer may exist. Adopting an
		// orphaned one keeps a lost mapping from wedging every later projection on
		// that unique index.
		const requestId =
			(reviewerUserId
				? await this.findActiveReviewerRequest(context, reviewerUserId)
				: undefined) ??
			(await this.createNativeReviewerRequest(context, reviewerUserId))

		const [{ occurrences } = { occurrences: 0 }] = await transaction
			.select({ occurrences: count() })
			.from(gitHubPullRequestReviewerRequestMappings)
			.where(
				and(
					eq(
						gitHubPullRequestReviewerRequestMappings.pullRequestMappingId,
						target.pullRequestMappingId
					),
					eq(
						gitHubPullRequestReviewerRequestMappings.targetKind,
						requested.kind
					),
					eq(
						gitHubPullRequestReviewerRequestMappings.targetNodeId,
						targetNodeId
					)
				)
			)

		await transaction.insert(gitHubPullRequestReviewerRequestMappings).values({
			pullRequestMappingId: target.pullRequestMappingId,
			pullRequestReviewerRequestId: requestId,
			externalKey: `${target.pullRequestMappingId}:${requested.kind}:${targetNodeId}:${occurrences}`,
			targetKind: requested.kind,
			targetNodeId,
			targetNumericId:
				requested.kind === 'user'
					? requested.actor.numericId
					: requested.numericId,
			targetActorId,
			teamSlug: requested.kind === 'team' ? requested.slug : undefined,
			teamName: requested.kind === 'team' ? requested.name : undefined,
			teamHtmlUrl: requested.kind === 'team' ? requested.htmlUrl : undefined,
			requestedByActorId: request?.actorId,
			deliveryId: request?.deliveryId,
			active: true,
			lastSeenSyncVersion: syncVersion,
		})
	}

	private async findActiveReviewerRequest(
		{ target, transaction }: ProjectionContext,
		reviewerUserId: UserId
	): Promise<PullRequestReviewerRequestId | undefined> {
		const [request] = await transaction
			.select({ id: pullRequestReviewerRequests.id })
			.from(pullRequestReviewerRequests)
			.where(
				and(
					eq(pullRequestReviewerRequests.pullRequestId, target.pullRequestId),
					eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
					isNull(pullRequestReviewerRequests.removedAt),
					isNull(pullRequestReviewerRequests.fulfilledByReviewId)
				)
			)
			.limit(1)

		return request?.id
	}

	private async createNativeReviewerRequest(
		{ target, transaction }: ProjectionContext,
		reviewerUserId: UserId | null
	): Promise<PullRequestReviewerRequestId> {
		const [createdRequest] = await transaction
			.insert(pullRequestReviewerRequests)
			.values({
				pullRequestId: target.pullRequestId,
				provider: 'github',
				reviewerUserId,
			})
			.returning({ id: pullRequestReviewerRequests.id })

		if (!createdRequest)
			throw new Error('failed to create synchronized GitHub reviewer request')

		return createdRequest.id
	}

	private async deactivateReviewerRequest(
		context: ProjectionContext,
		mapping: {
			id: GitHubPullRequestReviewerRequestMappingId
			pullRequestReviewerRequestId: PullRequestReviewerRequestId | null
			targetActorId: GitHubActorId | null
			targetNodeId: string
		}
	): Promise<void> {
		const { syncedAt, syncVersion, transaction } = context
		const removal = this.findReviewerRequestDelivery(context, {
			action: 'review_request_removed',
			targetActorId: mapping.targetActorId ?? undefined,
			targetNodeId: mapping.targetNodeId,
		})

		if (mapping.pullRequestReviewerRequestId)
			await transaction
				.update(pullRequestReviewerRequests)
				.set({ removedAt: removal?.receivedAt ?? syncedAt })
				.where(
					and(
						eq(
							pullRequestReviewerRequests.id,
							mapping.pullRequestReviewerRequestId
						),
						isNull(pullRequestReviewerRequests.removedAt)
					)
				)

		await transaction
			.update(gitHubPullRequestReviewerRequestMappings)
			.set({
				active: false,
				removedByActorId: removal?.actorId ?? null,
				lastSeenSyncVersion: syncVersion,
			})
			.where(eq(gitHubPullRequestReviewerRequestMappings.id, mapping.id))
	}

	/**
	 * Everything the provider still knows about was stamped with this sync
	 * version, so whatever kept an older stamp is gone from GitHub. Comments are
	 * hard-deleted the way a native deletion works, and the mapping keeps the
	 * tombstone so a later sweep does not resurrect them.
	 */
	private async tombstoneAbsentResources(
		context: ProjectionContext
	): Promise<void> {
		const { syncedAt, syncVersion, target, transaction } = context
		const staleComments = await transaction
			.select({
				id: gitHubPullRequestCommentMappings.id,
				pullRequestCommentId:
					gitHubPullRequestCommentMappings.pullRequestCommentId,
			})
			.from(gitHubPullRequestCommentMappings)
			.where(
				and(
					eq(
						gitHubPullRequestCommentMappings.pullRequestMappingId,
						target.pullRequestMappingId
					),
					lt(gitHubPullRequestCommentMappings.lastSeenSyncVersion, syncVersion),
					isNull(gitHubPullRequestCommentMappings.providerDeletedAt)
				)
			)
		const affectedThreadIds = new Set<PullRequestThreadId>()

		for (const mapping of staleComments) {
			if (mapping.pullRequestCommentId) {
				const [deletedComment] = await transaction
					.delete(pullRequestComments)
					.where(eq(pullRequestComments.id, mapping.pullRequestCommentId))
					.returning({ threadId: pullRequestComments.threadId })

				if (deletedComment) affectedThreadIds.add(deletedComment.threadId)
			}

			await transaction
				.update(gitHubPullRequestCommentMappings)
				.set({ providerDeletedAt: syncedAt, pullRequestCommentId: null })
				.where(eq(gitHubPullRequestCommentMappings.id, mapping.id))
		}

		const staleThreads = await transaction
			.select({
				id: gitHubPullRequestThreadMappings.id,
				externalNodeId: gitHubPullRequestThreadMappings.externalNodeId,
				rootCommentNodeId: gitHubPullRequestThreadMappings.rootCommentNodeId,
				pullRequestThreadId:
					gitHubPullRequestThreadMappings.pullRequestThreadId,
			})
			.from(gitHubPullRequestThreadMappings)
			.where(
				and(
					eq(
						gitHubPullRequestThreadMappings.pullRequestMappingId,
						target.pullRequestMappingId
					),
					lt(gitHubPullRequestThreadMappings.lastSeenSyncVersion, syncVersion),
					isNull(gitHubPullRequestThreadMappings.deletedAt)
				)
			)

		for (const mapping of staleThreads) {
			// A thread GitHub deleted takes everything still hanging on it: a reply
			// whose root went first would otherwise keep the thread alive and render
			// a conversation that no longer exists anywhere.
			if (mapping.pullRequestThreadId) {
				affectedThreadIds.delete(mapping.pullRequestThreadId)
				await this.deleteThreadWithComments(
					context,
					mapping.pullRequestThreadId
				)
			}

			await transaction
				.update(gitHubPullRequestThreadMappings)
				.set({
					deletedAt: syncedAt,
					pullRequestThreadId: null,
					// The node ids stay unique across live and tombstoned rows, so a
					// tombstone keeps them namespaced by its own id: the thread that
					// replaces this one has to be able to claim them back.
					externalNodeId: toTombstonedNodeId(
						mapping.id,
						mapping.externalNodeId
					),
					rootCommentNodeId: toTombstonedNodeId(
						mapping.id,
						mapping.rootCommentNodeId
					),
				})
				.where(eq(gitHubPullRequestThreadMappings.id, mapping.id))
		}

		await this.deleteEmptyThreads(context, affectedThreadIds)
		await this.tombstoneAbsentReviews(context)
	}

	private async deleteThreadWithComments(
		{ syncedAt, transaction }: ProjectionContext,
		threadId: PullRequestThreadId
	): Promise<void> {
		const comments = await transaction
			.delete(pullRequestComments)
			.where(eq(pullRequestComments.threadId, threadId))
			.returning({ id: pullRequestComments.id })

		if (comments.length > 0)
			await transaction
				.update(gitHubPullRequestCommentMappings)
				.set({ providerDeletedAt: syncedAt, pullRequestCommentId: null })
				.where(
					inArray(
						gitHubPullRequestCommentMappings.pullRequestCommentId,
						comments.map(comment => comment.id)
					)
				)

		await transaction
			.update(gitHubPullRequestThreadMappings)
			.set({ pullRequestThreadId: null })
			.where(eq(gitHubPullRequestThreadMappings.pullRequestThreadId, threadId))
		await transaction
			.delete(pullRequestThreads)
			.where(eq(pullRequestThreads.id, threadId))
	}

	private async deleteEmptyThreads(
		{ transaction }: ProjectionContext,
		threadIds: Set<PullRequestThreadId>
	): Promise<void> {
		for (const threadId of threadIds) {
			const [remainingComment] = await transaction
				.select({ id: pullRequestComments.id })
				.from(pullRequestComments)
				.where(eq(pullRequestComments.threadId, threadId))
				.limit(1)

			if (remainingComment) continue

			await transaction
				.update(gitHubPullRequestThreadMappings)
				.set({ pullRequestThreadId: null })
				.where(
					eq(gitHubPullRequestThreadMappings.pullRequestThreadId, threadId)
				)
			await transaction
				.delete(pullRequestThreads)
				.where(eq(pullRequestThreads.id, threadId))
		}
	}

	private async tombstoneAbsentReviews(
		context: ProjectionContext
	): Promise<void> {
		const { syncedAt, syncVersion, target, transaction } = context
		const staleReviews = await transaction
			.select({
				id: gitHubPullRequestReviewMappings.id,
				pullRequestReviewId:
					gitHubPullRequestReviewMappings.pullRequestReviewId,
			})
			.from(gitHubPullRequestReviewMappings)
			.where(
				and(
					eq(
						gitHubPullRequestReviewMappings.pullRequestMappingId,
						target.pullRequestMappingId
					),
					lt(gitHubPullRequestReviewMappings.lastSeenSyncVersion, syncVersion),
					isNull(gitHubPullRequestReviewMappings.providerDeletedAt)
				)
			)

		for (const mapping of staleReviews) {
			if (mapping.pullRequestReviewId) {
				await transaction
					.update(pullRequestComments)
					.set({ reviewId: null })
					.where(eq(pullRequestComments.reviewId, mapping.pullRequestReviewId))
				await transaction
					.delete(pullRequestReviews)
					.where(eq(pullRequestReviews.id, mapping.pullRequestReviewId))
			}

			await transaction
				.update(gitHubPullRequestReviewMappings)
				.set({ providerDeletedAt: syncedAt, pullRequestReviewId: null })
				.where(eq(gitHubPullRequestReviewMappings.id, mapping.id))
		}
	}

	private async createThreadResolutionEvent(
		context: ProjectionContext,
		{
			actorId,
			createdAt,
			deliveryId,
			resolved,
			threadId,
			threadNodeId,
		}: {
			actorId?: GitHubActorId
			createdAt: Date
			deliveryId?: GitHubWebhookDeliveryId
			resolved: boolean
			threadId: PullRequestThreadId
			threadNodeId: string
		}
	): Promise<void> {
		if (!actorId) return

		const [thread] = await context.transaction
			.select({ kind: pullRequestThreads.kind, path: pullRequestThreads.path })
			.from(pullRequestThreads)
			.where(eq(pullRequestThreads.id, threadId))
			.limit(1)

		if (!thread) return

		const type = resolved ? 'thread_resolved' : 'thread_unresolved'

		await this.createGitHubEvent(context, {
			actorId,
			createdAt,
			deliveryId,
			externalKey: `${threadNodeId}:${type}:${createdAt.toISOString()}`,
			payload: {
				threadId,
				threadKind: thread.kind,
				path: thread.path ?? undefined,
			},
			type,
		})
	}

	private async createGitHubEvent(
		{ target, transaction }: ProjectionContext,
		{
			actorId,
			createdAt,
			deliveryId,
			externalKey,
			payload,
			type,
		}: {
			actorId: GitHubActorId
			createdAt: Date
			deliveryId?: GitHubWebhookDeliveryId
			externalKey: string
			payload: PullRequestEventPayload
			type:
				| 'review_submitted'
				| 'review_dismissed'
				| 'thread_resolved'
				| 'thread_unresolved'
		}
	): Promise<void> {
		const [existingMapping] = await transaction
			.select({ id: gitHubPullRequestEventMappings.id })
			.from(gitHubPullRequestEventMappings)
			.where(eq(gitHubPullRequestEventMappings.externalKey, externalKey))
			.limit(1)

		if (existingMapping) return

		const [event] = await transaction
			.insert(pullRequestEvents)
			.values({
				pullRequestId: target.pullRequestId,
				provider: 'github',
				type,
				payload,
				createdAt,
			})
			.returning({ id: pullRequestEvents.id })

		if (!event) throw new Error('failed to create synchronized GitHub event')

		await transaction.insert(gitHubPullRequestEventMappings).values({
			pullRequestEventId: event.id,
			externalKey,
			actorId,
			deliveryId,
			createdAt,
		})
	}

	/**
	 * A `pull_request` delivery names the pull request, not the reviewer, so a
	 * request is matched through the reviewer or team the webhook carried aside.
	 * REST cannot recover a requester otherwise: it only reports current state.
	 */
	private findReviewerRequestDelivery(
		{ deliveries }: ProjectionContext,
		{
			action,
			targetActorId,
			targetNodeId,
		}: {
			action: 'review_requested' | 'review_request_removed'
			targetActorId?: GitHubActorId
			targetNodeId: string
		}
	): GitHubPendingConversationDelivery | undefined {
		return deliveries.find(
			delivery =>
				delivery.eventName === 'pull_request' &&
				delivery.action === action &&
				((targetActorId !== undefined &&
					delivery.targetActorId === targetActorId) ||
					delivery.targetTeamNodeId === targetNodeId)
		)
	}

	/**
	 * Webhooks are triggers, not authority: a matching delivery only supplies the
	 * actor and timing that the REST and GraphQL snapshots leave out. Only the
	 * resource the delivery names is matched — provenance is optional, and
	 * attributing one delivery to every resource of its kind is worse than none.
	 */
	private findDelivery(
		{ deliveries }: ProjectionContext,
		{
			action,
			eventName,
			externalNodeId,
			externalNumericId,
		}: {
			action: string
			eventName: string
			externalNodeId?: string
			externalNumericId?: bigint
		}
	): GitHubPendingConversationDelivery | undefined {
		return deliveries.find(
			delivery =>
				delivery.eventName === eventName &&
				delivery.action === action &&
				((externalNodeId !== undefined &&
					delivery.targetResourceNodeId === externalNodeId) ||
					(externalNumericId !== undefined &&
						delivery.targetResourceNumericId === externalNumericId))
		)
	}
}

/**
 * A transition the native model cannot show yet is deferred rather than
 * recorded: advancing the mapping would consume the very change the timeline
 * event is raised from, and nothing would detect it a second time.
 */
function toThreadResolutionColumns(
	existingMapping: GitHubThreadMappingState | undefined,
	resolution: GitHubThreadResolution,
	isProjected: boolean
) {
	if (!isProjected)
		return {
			resolvedByActorId: existingMapping?.resolvedByActorId ?? null,
			providerResolved: existingMapping?.providerResolved ?? false,
			providerResolvedAt: existingMapping?.providerResolvedAt ?? null,
			deliveryId: existingMapping?.deliveryId ?? null,
		}

	return {
		resolvedByActorId: resolution.actorId ?? null,
		providerResolved: resolution.resolved,
		providerResolvedAt: resolution.resolvedAt ?? null,
		deliveryId: resolution.delivery?.deliveryId ?? null,
	}
}

/**
 * A placement GitHub stopped reporting arrives as an absent field, and an absent
 * field is omitted from the update — which would leave the mapping claiming a
 * line or a commit the comment no longer has.
 */
function toCommentMappingValues(
	context: ProjectionContext,
	params: CommentProjectionParams,
	commentId: PullRequestCommentId | undefined
): NewGitHubPullRequestCommentMapping {
	const comment = params.reviewComment

	return {
		pullRequestMappingId: context.target.pullRequestMappingId,
		threadMappingId: params.threadMappingId ?? null,
		pullRequestCommentId: commentId ?? null,
		kind: params.kind,
		externalNodeId: params.externalNodeId,
		externalNumericId: params.externalNumericId,
		authorActorId: params.authorActorId,
		parentExternalNodeId: comment?.inReplyToNumericId
			? (context.commentNodeIdsByNumericId.get(comment.inReplyToNumericId) ??
				null)
			: null,
		parentExternalNumericId: comment?.inReplyToNumericId ?? null,
		reviewExternalNodeId: comment?.reviewNumericId
			? (context.reviewNodeIdsByNumericId.get(comment.reviewNumericId) ?? null)
			: null,
		reviewExternalNumericId: comment?.reviewNumericId ?? null,
		htmlUrl: params.htmlUrl,
		subjectType: comment?.subjectType ?? null,
		path: comment?.path ?? null,
		side: comment?.side ?? null,
		line: comment?.line ?? null,
		originalLine: comment?.originalLine ?? null,
		startSide: comment?.startSide ?? null,
		startLine: comment?.startLine ?? null,
		originalStartLine: comment?.originalStartLine ?? null,
		commitId: comment?.commitId ?? null,
		originalCommitId: comment?.originalCommitId ?? null,
		diffHunk: comment?.diffHunk ?? null,
		providerCreatedAt: params.createdAt,
		providerUpdatedAt: params.updatedAt,
		providerDeletedAt: null,
		lastSeenSyncVersion: context.syncVersion,
	}
}

/** A write-through echo stamped a later version, so this snapshot predates it. */
function isNewerThanSnapshot(
	mapping: { lastSeenSyncVersion: number } | undefined,
	syncVersion: number
): boolean {
	return mapping !== undefined && mapping.lastSeenSyncVersion > syncVersion
}

/** Keeps a deleted thread's identity readable without letting it collide. */
export function toTombstonedNodeId(
	mappingId: GitHubPullRequestThreadMappingId,
	nodeId: string | null
): string | null {
	if (!nodeId) return null

	return `deleted:${mappingId}:${nodeId}`
}

function requireActorId(
	{ actorIds }: ProjectionContext,
	actor: GitHubSyncActor
): GitHubActorId {
	const actorId = actorIds.get(actor.nodeId)

	if (!actorId)
		throw new Error('synchronized GitHub conversation actor mapping is missing')

	return actorId
}

function toReviewerTargetNodeId(
	requested: GitHubSyncReviewerRequestTarget
): string {
	return requested.kind === 'user' ? requested.actor.nodeId : requested.nodeId
}
