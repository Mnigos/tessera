import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { PullRequestThreadAnchor } from '@repo/contracts'
import {
	and,
	asc,
	countDistinct,
	type DrizzleTransaction,
	eq,
	gitHubActors,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestThreadMappings,
	inArray,
	isNotNull,
	isNull,
	or,
	type PullRequestComment,
	type PullRequestEvent,
	type PullRequestEventPayload,
	type PullRequestThread,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviews,
	pullRequestThreads,
	user,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	UserId,
} from '@repo/domain'
import { alias } from 'drizzle-orm/pg-core'
import type { PullRequestActorReadModel } from '../domain/pull-request-actor'

interface PullRequestParams {
	pullRequestId: PullRequestId
}

/**
 * Reads are scoped to a viewer because pending review comments are visible only
 * to their author until the review is submitted.
 */
interface ViewerParams {
	viewerUserId?: UserId
}

interface ListParams extends PullRequestParams, ViewerParams {
	path?: string
}

interface ThreadParams {
	threadId: PullRequestThreadId
}

interface CommentParams {
	commentId: PullRequestCommentId
}

interface FindThreadParams extends ThreadParams, ViewerParams {}

interface FindCommentParams extends CommentParams, ViewerParams {}

interface PendingCommentParams {
	reviewId?: PullRequestReviewId
}

interface CreateThreadParams extends PullRequestParams, PendingCommentParams {
	anchor?: PullRequestThreadAnchor
	authorUserId: UserId
	body: string
}

interface CreateCommentParams
	extends PullRequestParams,
		ThreadParams,
		PendingCommentParams {
	authorUserId: UserId
	body: string
}

interface EditCommentParams extends CommentParams, ViewerParams {
	body: string
	editedAt: Date
}

interface DeleteCommentParams extends CommentParams, ThreadParams {}

interface ThreadResolutionParams extends PullRequestParams, ThreadParams {
	actorUserId: UserId
}

interface ResolveThreadParams extends ThreadResolutionParams {
	resolvedAt: Date
}

type PullRequestThreadDatabase = Database | DrizzleTransaction

export interface PullRequestCommentReadModel extends PullRequestComment {
	author: PullRequestActorReadModel
	sourceUrl: string | null
}

export interface PullRequestThreadReadModel extends PullRequestThread {
	comments: PullRequestCommentReadModel[]
	resolvedBy: PullRequestActorReadModel
	/** GitHub's own verdict on the anchor, which outlives a base/head comparison. */
	providerOutdated: boolean | null
}

type PullRequestThreadResolutionFailure =
	| { status: 'thread_not_found' }
	| { status: 'thread_unpublished' }

export type PullRequestThreadResolutionResult =
	| { status: 'updated'; thread: PullRequestThreadReadModel }
	| PullRequestThreadResolutionFailure

export interface PullRequestCommentContext {
	authorUserId: UserId | null
	id: PullRequestCommentId
	pullRequestId: PullRequestId
	threadId: PullRequestThreadId
}

const resolvedByUser = alias(user, 'pull_request_thread_resolved_by_user')
const commentAuthorUser = alias(user, 'pull_request_comment_author_user')
const resolvedByGitHubActor = alias(
	gitHubActors,
	'pull_request_thread_resolved_by_github_actor'
)
const commentAuthorGitHubActor = alias(
	gitHubActors,
	'pull_request_comment_author_github_actor'
)

const THREAD_READ_COLUMNS = {
	id: pullRequestThreads.id,
	pullRequestId: pullRequestThreads.pullRequestId,
	provider: pullRequestThreads.provider,
	kind: pullRequestThreads.kind,
	path: pullRequestThreads.path,
	side: pullRequestThreads.side,
	startLine: pullRequestThreads.startLine,
	line: pullRequestThreads.line,
	anchorSha: pullRequestThreads.anchorSha,
	baseSha: pullRequestThreads.baseSha,
	headSha: pullRequestThreads.headSha,
	lineExcerpt: pullRequestThreads.lineExcerpt,
	resolvedAt: pullRequestThreads.resolvedAt,
	resolvedByUserId: pullRequestThreads.resolvedByUserId,
	createdAt: pullRequestThreads.createdAt,
	updatedAt: pullRequestThreads.updatedAt,
	resolvedBy: {
		userId: pullRequestThreads.resolvedByUserId,
		username: resolvedByUser.username,
		displayName: resolvedByUser.name,
		imageUrl: resolvedByUser.image,
		externalNodeId: resolvedByGitHubActor.externalNodeId,
		externalLogin: resolvedByGitHubActor.login,
		externalAvatarUrl: resolvedByGitHubActor.avatarUrl,
		externalHtmlUrl: resolvedByGitHubActor.htmlUrl,
	},
	providerOutdated: gitHubPullRequestThreadMappings.providerOutdated,
}

const COMMENT_READ_COLUMNS = {
	id: pullRequestComments.id,
	threadId: pullRequestComments.threadId,
	provider: pullRequestComments.provider,
	authorUserId: pullRequestComments.authorUserId,
	body: pullRequestComments.body,
	state: pullRequestComments.state,
	reviewId: pullRequestComments.reviewId,
	createdAt: pullRequestComments.createdAt,
	updatedAt: pullRequestComments.updatedAt,
	editedAt: pullRequestComments.editedAt,
	author: {
		userId: pullRequestComments.authorUserId,
		username: commentAuthorUser.username,
		displayName: commentAuthorUser.name,
		imageUrl: commentAuthorUser.image,
		externalNodeId: commentAuthorGitHubActor.externalNodeId,
		externalLogin: commentAuthorGitHubActor.login,
		externalAvatarUrl: commentAuthorGitHubActor.avatarUrl,
		externalHtmlUrl: commentAuthorGitHubActor.htmlUrl,
	},
	sourceUrl: gitHubPullRequestCommentMappings.htmlUrl,
}

const THREAD_EVENT_COLUMNS = {
	kind: pullRequestThreads.kind,
	path: pullRequestThreads.path,
}

@Injectable()
export class PullRequestThreadsRepository {
	constructor(private readonly db: Database) {}

	async list({
		path,
		pullRequestId,
		viewerUserId,
	}: ListParams): Promise<PullRequestThreadReadModel[]> {
		const conditions = [eq(pullRequestThreads.pullRequestId, pullRequestId)]

		if (path) conditions.push(eq(pullRequestThreads.path, path))

		const threads = await this.db
			.select(THREAD_READ_COLUMNS)
			.from(pullRequestThreads)
			.leftJoin(
				resolvedByUser,
				eq(resolvedByUser.id, pullRequestThreads.resolvedByUserId)
			)
			.leftJoin(
				gitHubPullRequestThreadMappings,
				eq(
					gitHubPullRequestThreadMappings.pullRequestThreadId,
					pullRequestThreads.id
				)
			)
			.leftJoin(
				resolvedByGitHubActor,
				eq(
					resolvedByGitHubActor.id,
					gitHubPullRequestThreadMappings.resolvedByActorId
				)
			)
			.where(and(...conditions))
			.orderBy(asc(pullRequestThreads.createdAt))
		const threadsWithComments = await this.withComments(
			this.db,
			threads,
			viewerUserId
		)

		// A thread whose comments are all somebody else's pending draft must not
		// leak as an empty thread.
		return threadsWithComments.filter(thread => thread.comments.length > 0)
	}

	/**
	 * Threads a merge requirement can be refused over: unresolved, and carrying
	 * at least one published comment. Inline and top-level threads count alike,
	 * an outdated anchor is still an unanswered question, and a thread holding
	 * nothing but somebody's pending draft is not yet a question at all.
	 */
	async countUnresolvedThreads({
		pullRequestId,
	}: PullRequestParams): Promise<number> {
		const [row] = await this.db
			.select({ count: countDistinct(pullRequestThreads.id) })
			.from(pullRequestThreads)
			.innerJoin(
				pullRequestComments,
				and(
					eq(pullRequestComments.threadId, pullRequestThreads.id),
					eq(pullRequestComments.state, 'published')
				)
			)
			.where(
				and(
					eq(pullRequestThreads.pullRequestId, pullRequestId),
					isNull(pullRequestThreads.resolvedAt)
				)
			)

		return row?.count ?? 0
	}

	async findThread({
		threadId,
		viewerUserId,
	}: FindThreadParams): Promise<PullRequestThreadReadModel | undefined> {
		return await this.findThreadIn(this.db, threadId, viewerUserId)
	}

	async findComment({
		commentId,
		viewerUserId,
	}: FindCommentParams): Promise<PullRequestCommentContext | undefined> {
		const [comment] = await this.db
			.select({
				id: pullRequestComments.id,
				threadId: pullRequestComments.threadId,
				authorUserId: pullRequestComments.authorUserId,
				pullRequestId: pullRequestThreads.pullRequestId,
			})
			.from(pullRequestComments)
			.innerJoin(
				pullRequestThreads,
				eq(pullRequestThreads.id, pullRequestComments.threadId)
			)
			.where(
				and(
					eq(pullRequestComments.id, commentId),
					visibleToViewer(viewerUserId)
				)
			)
			.limit(1)

		return comment
	}

	async createThread({
		anchor,
		authorUserId,
		body,
		pullRequestId,
		reviewId,
	}: CreateThreadParams): Promise<PullRequestThreadReadModel | undefined> {
		return await this.db.transaction(async tx => {
			if (reviewId && !(await this.lockPendingReview(tx, reviewId)))
				return undefined

			const [thread] = await tx
				.insert(pullRequestThreads)
				.values({
					pullRequestId,
					kind: anchor ? 'inline' : 'top_level',
					path: anchor?.path,
					side: anchor?.side,
					// The column carries a range only; a single line repeats its own start.
					startLine:
						anchor && anchor.startLine < anchor.endLine
							? anchor.startLine
							: undefined,
					line: anchor?.endLine,
					anchorSha: anchor?.anchorSha,
					baseSha: anchor?.baseSha,
					headSha: anchor?.headSha,
					lineExcerpt: anchor?.lineExcerpt,
				})
				.returning({ id: pullRequestThreads.id, ...THREAD_EVENT_COLUMNS })

			if (!thread) throw new Error('failed to create pull request thread')

			const commentId = await this.insertComment(tx, {
				threadId: thread.id,
				authorUserId,
				body,
				reviewId,
			})

			// Pending review comments stay sealed until submission, so they emit no
			// timeline event.
			if (!reviewId)
				await this.createEvent(tx, {
					pullRequestId,
					actorUserId: authorUserId,
					type: 'commented',
					payload: {
						threadId: thread.id,
						commentId,
						threadKind: thread.kind,
						path: thread.path ?? undefined,
					},
				})

			return await this.requireThread(tx, thread.id, authorUserId)
		})
	}

	async createComment({
		authorUserId,
		body,
		pullRequestId,
		reviewId,
		threadId,
	}: CreateCommentParams): Promise<PullRequestThreadReadModel | undefined> {
		return await this.db.transaction(async tx => {
			if (reviewId && !(await this.lockPendingReview(tx, reviewId)))
				return undefined

			const commentId = await this.insertComment(tx, {
				threadId,
				authorUserId,
				body,
				reviewId,
			})
			const thread = await this.requireThread(tx, threadId, authorUserId)

			if (!reviewId)
				await this.createEvent(tx, {
					pullRequestId,
					actorUserId: authorUserId,
					type: 'commented',
					payload: {
						threadId,
						commentId,
						threadKind: thread.kind,
						path: thread.path ?? undefined,
					},
				})

			return thread
		})
	}

	async editComment({
		body,
		commentId,
		editedAt,
		viewerUserId,
	}: EditCommentParams): Promise<PullRequestCommentReadModel | undefined> {
		const [comment] = await this.db
			.update(pullRequestComments)
			.set({ body, editedAt })
			.where(
				and(
					eq(pullRequestComments.id, commentId),
					visibleToViewer(viewerUserId)
				)
			)
			.returning({ id: pullRequestComments.id })

		if (!comment) return undefined

		return await this.findCommentReadModel({ commentId, viewerUserId })
	}

	async findCommentReadModel({
		commentId,
		viewerUserId,
	}: FindCommentParams): Promise<PullRequestCommentReadModel | undefined> {
		const [comment] = await this.db
			.select(COMMENT_READ_COLUMNS)
			.from(pullRequestComments)
			.leftJoin(
				commentAuthorUser,
				eq(commentAuthorUser.id, pullRequestComments.authorUserId)
			)
			.leftJoin(
				gitHubPullRequestCommentMappings,
				eq(
					gitHubPullRequestCommentMappings.pullRequestCommentId,
					pullRequestComments.id
				)
			)
			.leftJoin(
				commentAuthorGitHubActor,
				eq(
					commentAuthorGitHubActor.id,
					gitHubPullRequestCommentMappings.authorActorId
				)
			)
			.where(
				and(
					eq(pullRequestComments.id, commentId),
					visibleToViewer(viewerUserId)
				)
			)
			.limit(1)

		return comment
	}

	async deleteComment({
		commentId,
		threadId,
	}: DeleteCommentParams): Promise<boolean> {
		return await this.db.transaction(async tx => {
			// Serialises concurrent deletions of the last comments so exactly one of
			// them observes the empty thread and removes it.
			await tx
				.select({ id: pullRequestThreads.id })
				.from(pullRequestThreads)
				.where(eq(pullRequestThreads.id, threadId))
				.for('update')

			await tx
				.delete(pullRequestComments)
				.where(eq(pullRequestComments.id, commentId))

			const [remainingComment] = await tx
				.select({ id: pullRequestComments.id })
				.from(pullRequestComments)
				.where(eq(pullRequestComments.threadId, threadId))
				.limit(1)

			if (remainingComment) return false

			await tx
				.delete(pullRequestThreads)
				.where(eq(pullRequestThreads.id, threadId))

			return true
		})
	}

	async resolveThread({
		actorUserId,
		pullRequestId,
		resolvedAt,
		threadId,
	}: ResolveThreadParams): Promise<PullRequestThreadResolutionResult> {
		return await this.db.transaction(async tx => {
			const failure = await this.lockResolvableThread(tx, threadId)

			if (failure) return failure

			const [thread] = await tx
				.update(pullRequestThreads)
				.set({ resolvedAt, resolvedByUserId: actorUserId })
				.where(
					and(
						eq(pullRequestThreads.id, threadId),
						isNull(pullRequestThreads.resolvedAt)
					)
				)
				.returning(THREAD_EVENT_COLUMNS)

			if (thread)
				await this.createEvent(tx, {
					pullRequestId,
					actorUserId,
					type: 'thread_resolved',
					payload: {
						threadId,
						threadKind: thread.kind,
						path: thread.path ?? undefined,
					},
				})

			return {
				status: 'updated',
				thread: await this.requireThread(tx, threadId, actorUserId),
			}
		})
	}

	async unresolveThread({
		actorUserId,
		pullRequestId,
		threadId,
	}: ThreadResolutionParams): Promise<PullRequestThreadResolutionResult> {
		return await this.db.transaction(async tx => {
			const failure = await this.lockResolvableThread(tx, threadId)

			if (failure) return failure

			const [thread] = await tx
				.update(pullRequestThreads)
				.set({ resolvedAt: null, resolvedByUserId: null })
				.where(
					and(
						eq(pullRequestThreads.id, threadId),
						isNotNull(pullRequestThreads.resolvedAt)
					)
				)
				.returning(THREAD_EVENT_COLUMNS)

			if (thread)
				await this.createEvent(tx, {
					pullRequestId,
					actorUserId,
					type: 'thread_unresolved',
					payload: {
						threadId,
						threadKind: thread.kind,
						path: thread.path ?? undefined,
					},
				})

			return {
				status: 'updated',
				thread: await this.requireThread(tx, threadId, actorUserId),
			}
		})
	}

	/**
	 * Holds the thread for the rest of the resolution and re-checks that it still
	 * carries a published comment. The caller's earlier check can go stale: a
	 * concurrent deletion of the last published comment would otherwise announce
	 * a resolution over somebody's private draft, or over a thread that the same
	 * deletion has already removed.
	 */
	private async lockResolvableThread(
		tx: DrizzleTransaction,
		threadId: PullRequestThreadId
	): Promise<PullRequestThreadResolutionFailure | undefined> {
		const [thread] = await tx
			.select({ id: pullRequestThreads.id })
			.from(pullRequestThreads)
			.where(eq(pullRequestThreads.id, threadId))
			.for('update')

		if (!thread) return { status: 'thread_not_found' }

		const [publishedComment] = await tx
			.select({ id: pullRequestComments.id })
			.from(pullRequestComments)
			.where(
				and(
					eq(pullRequestComments.threadId, threadId),
					eq(pullRequestComments.state, 'published')
				)
			)
			.limit(1)

		return publishedComment ? undefined : { status: 'thread_unpublished' }
	}

	/**
	 * Holds the pending review for the rest of the insert so a concurrent
	 * submission cannot seal the envelope between the check and the comment
	 * landing in it. A review that is no longer pending stops the write.
	 */
	private async lockPendingReview(
		tx: DrizzleTransaction,
		reviewId: PullRequestReviewId
	): Promise<boolean> {
		const [review] = await tx
			.select({ id: pullRequestReviews.id })
			.from(pullRequestReviews)
			.where(
				and(
					eq(pullRequestReviews.id, reviewId),
					eq(pullRequestReviews.state, 'pending')
				)
			)
			.for('update')

		return Boolean(review)
	}

	private async insertComment(
		tx: DrizzleTransaction,
		{
			authorUserId,
			body,
			reviewId,
			threadId,
		}: {
			authorUserId: UserId
			body: string
			reviewId?: PullRequestReviewId
			threadId: PullRequestThreadId
		}
	): Promise<PullRequestCommentId> {
		const [comment] = await tx
			.insert(pullRequestComments)
			.values({
				threadId,
				authorUserId,
				body,
				reviewId,
				state: reviewId ? 'pending' : 'published',
			})
			.returning({ id: pullRequestComments.id })

		if (!comment) throw new Error('failed to create pull request comment')

		return comment.id
	}

	private async createEvent(
		db: PullRequestThreadDatabase,
		params: {
			actorUserId: UserId
			payload: PullRequestEventPayload
			pullRequestId: PullRequestId
			type: PullRequestEvent['type']
		}
	) {
		await db.insert(pullRequestEvents).values(params)
	}

	private async requireThread(
		db: PullRequestThreadDatabase,
		threadId: PullRequestThreadId,
		viewerUserId?: UserId
	): Promise<PullRequestThreadReadModel> {
		const thread = await this.findThreadIn(db, threadId, viewerUserId)

		if (!thread) throw new Error('pull request thread is missing after write')

		return thread
	}

	private async findThreadIn(
		db: PullRequestThreadDatabase,
		threadId: PullRequestThreadId,
		viewerUserId?: UserId
	): Promise<PullRequestThreadReadModel | undefined> {
		const [thread] = await db
			.select(THREAD_READ_COLUMNS)
			.from(pullRequestThreads)
			.leftJoin(
				resolvedByUser,
				eq(resolvedByUser.id, pullRequestThreads.resolvedByUserId)
			)
			.leftJoin(
				gitHubPullRequestThreadMappings,
				eq(
					gitHubPullRequestThreadMappings.pullRequestThreadId,
					pullRequestThreads.id
				)
			)
			.leftJoin(
				resolvedByGitHubActor,
				eq(
					resolvedByGitHubActor.id,
					gitHubPullRequestThreadMappings.resolvedByActorId
				)
			)
			.where(eq(pullRequestThreads.id, threadId))
			.limit(1)

		if (!thread) return undefined

		const [threadWithComments] = await this.withComments(
			db,
			[thread],
			viewerUserId
		)

		// A thread whose every comment belongs to somebody else's pending review
		// does not exist for this viewer: mutating it would leak the draft.
		if (!threadWithComments || threadWithComments.comments.length === 0)
			return undefined

		return threadWithComments
	}

	private async withComments(
		db: PullRequestThreadDatabase,
		threads: Omit<PullRequestThreadReadModel, 'comments'>[],
		viewerUserId?: UserId
	): Promise<PullRequestThreadReadModel[]> {
		if (threads.length === 0) return []

		const comments = await db
			.select(COMMENT_READ_COLUMNS)
			.from(pullRequestComments)
			.leftJoin(
				commentAuthorUser,
				eq(commentAuthorUser.id, pullRequestComments.authorUserId)
			)
			.leftJoin(
				gitHubPullRequestCommentMappings,
				eq(
					gitHubPullRequestCommentMappings.pullRequestCommentId,
					pullRequestComments.id
				)
			)
			.leftJoin(
				commentAuthorGitHubActor,
				eq(
					commentAuthorGitHubActor.id,
					gitHubPullRequestCommentMappings.authorActorId
				)
			)
			.where(
				and(
					inArray(
						pullRequestComments.threadId,
						threads.map(thread => thread.id)
					),
					visibleToViewer(viewerUserId)
				)
			)
			.orderBy(asc(pullRequestComments.createdAt))

		return threads.map(thread => ({
			...thread,
			comments: comments.filter(comment => comment.threadId === thread.id),
		}))
	}
}

/**
 * Published comments are public; a pending review comment is visible only to the
 * reviewer drafting it.
 */
function visibleToViewer(viewerUserId: UserId | undefined) {
	const published = eq(pullRequestComments.state, 'published')

	if (!viewerUserId) return published

	return or(
		published,
		and(
			eq(pullRequestComments.state, 'pending'),
			eq(pullRequestComments.authorUserId, viewerUserId)
		)
	)
}
