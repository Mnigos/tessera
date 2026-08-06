import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { PullRequestThreadAnchor } from '@repo/contracts'
import {
	and,
	asc,
	type DrizzleTransaction,
	eq,
	inArray,
	isNotNull,
	isNull,
	type PullRequestComment,
	type PullRequestEvent,
	type PullRequestEventPayload,
	type PullRequestThread,
	pullRequestComments,
	pullRequestEvents,
	pullRequestThreads,
	user,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestThreadId,
	UserId,
} from '@repo/domain'
import { alias } from 'drizzle-orm/pg-core'

interface PullRequestParams {
	pullRequestId: PullRequestId
}

interface ListParams extends PullRequestParams {
	path?: string
}

interface ThreadParams {
	threadId: PullRequestThreadId
}

interface CommentParams {
	commentId: PullRequestCommentId
}

interface CreateThreadParams extends PullRequestParams {
	anchor?: PullRequestThreadAnchor
	authorUserId: UserId
	body: string
}

interface CreateCommentParams extends PullRequestParams, ThreadParams {
	authorUserId: UserId
	body: string
}

interface EditCommentParams extends CommentParams {
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
	authorUsername: string | null
}

export interface PullRequestThreadReadModel extends PullRequestThread {
	comments: PullRequestCommentReadModel[]
	resolvedByUsername: string | null
}

export interface PullRequestCommentContext {
	authorUserId: UserId
	id: PullRequestCommentId
	pullRequestId: PullRequestId
	threadId: PullRequestThreadId
}

const resolvedByUser = alias(user, 'pull_request_thread_resolved_by_user')
const commentAuthorUser = alias(user, 'pull_request_comment_author_user')

const THREAD_READ_COLUMNS = {
	id: pullRequestThreads.id,
	pullRequestId: pullRequestThreads.pullRequestId,
	kind: pullRequestThreads.kind,
	path: pullRequestThreads.path,
	side: pullRequestThreads.side,
	line: pullRequestThreads.line,
	anchorSha: pullRequestThreads.anchorSha,
	baseSha: pullRequestThreads.baseSha,
	headSha: pullRequestThreads.headSha,
	lineExcerpt: pullRequestThreads.lineExcerpt,
	resolvedAt: pullRequestThreads.resolvedAt,
	resolvedByUserId: pullRequestThreads.resolvedByUserId,
	createdAt: pullRequestThreads.createdAt,
	updatedAt: pullRequestThreads.updatedAt,
	resolvedByUsername: resolvedByUser.username,
}

const COMMENT_READ_COLUMNS = {
	id: pullRequestComments.id,
	threadId: pullRequestComments.threadId,
	authorUserId: pullRequestComments.authorUserId,
	body: pullRequestComments.body,
	state: pullRequestComments.state,
	createdAt: pullRequestComments.createdAt,
	updatedAt: pullRequestComments.updatedAt,
	editedAt: pullRequestComments.editedAt,
	authorUsername: commentAuthorUser.username,
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
			.where(and(...conditions))
			.orderBy(asc(pullRequestThreads.createdAt))

		return await this.withComments(this.db, threads)
	}

	async findThread({
		threadId,
	}: ThreadParams): Promise<PullRequestThreadReadModel | undefined> {
		return await this.findThreadIn(this.db, threadId)
	}

	async findComment({
		commentId,
	}: CommentParams): Promise<PullRequestCommentContext | undefined> {
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
					eq(pullRequestComments.state, 'published')
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
	}: CreateThreadParams): Promise<PullRequestThreadReadModel> {
		return await this.db.transaction(async tx => {
			const [thread] = await tx
				.insert(pullRequestThreads)
				.values({
					pullRequestId,
					kind: anchor ? 'inline' : 'top_level',
					path: anchor?.path,
					side: anchor?.side,
					line: anchor?.line,
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
			})

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

			return await this.requireThread(tx, thread.id)
		})
	}

	async createComment({
		authorUserId,
		body,
		pullRequestId,
		threadId,
	}: CreateCommentParams): Promise<PullRequestThreadReadModel> {
		return await this.db.transaction(async tx => {
			const commentId = await this.insertComment(tx, {
				threadId,
				authorUserId,
				body,
			})
			const thread = await this.requireThread(tx, threadId)

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
	}: EditCommentParams): Promise<PullRequestCommentReadModel | undefined> {
		const [comment] = await this.db
			.update(pullRequestComments)
			.set({ body, editedAt })
			.where(
				and(
					eq(pullRequestComments.id, commentId),
					eq(pullRequestComments.state, 'published')
				)
			)
			.returning({ id: pullRequestComments.id })

		if (!comment) return undefined

		const [editedComment] = await this.db
			.select(COMMENT_READ_COLUMNS)
			.from(pullRequestComments)
			.innerJoin(
				commentAuthorUser,
				eq(commentAuthorUser.id, pullRequestComments.authorUserId)
			)
			.where(
				and(
					eq(pullRequestComments.id, commentId),
					eq(pullRequestComments.state, 'published')
				)
			)
			.limit(1)

		return editedComment
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
	}: ResolveThreadParams): Promise<PullRequestThreadReadModel> {
		return await this.db.transaction(async tx => {
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

			return await this.requireThread(tx, threadId)
		})
	}

	async unresolveThread({
		actorUserId,
		pullRequestId,
		threadId,
	}: ThreadResolutionParams): Promise<PullRequestThreadReadModel> {
		return await this.db.transaction(async tx => {
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

			return await this.requireThread(tx, threadId)
		})
	}

	private async insertComment(
		tx: DrizzleTransaction,
		values: {
			authorUserId: UserId
			body: string
			threadId: PullRequestThreadId
		}
	): Promise<PullRequestCommentId> {
		const [comment] = await tx
			.insert(pullRequestComments)
			.values(values)
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
		threadId: PullRequestThreadId
	): Promise<PullRequestThreadReadModel> {
		const thread = await this.findThreadIn(db, threadId)

		if (!thread) throw new Error('pull request thread is missing after write')

		return thread
	}

	private async findThreadIn(
		db: PullRequestThreadDatabase,
		threadId: PullRequestThreadId
	): Promise<PullRequestThreadReadModel | undefined> {
		const [thread] = await db
			.select(THREAD_READ_COLUMNS)
			.from(pullRequestThreads)
			.leftJoin(
				resolvedByUser,
				eq(resolvedByUser.id, pullRequestThreads.resolvedByUserId)
			)
			.where(eq(pullRequestThreads.id, threadId))
			.limit(1)

		if (!thread) return undefined

		const [threadWithComments] = await this.withComments(db, [thread])

		return threadWithComments
	}

	private async withComments(
		db: PullRequestThreadDatabase,
		threads: Omit<PullRequestThreadReadModel, 'comments'>[]
	): Promise<PullRequestThreadReadModel[]> {
		if (threads.length === 0) return []

		const comments = await db
			.select(COMMENT_READ_COLUMNS)
			.from(pullRequestComments)
			.innerJoin(
				commentAuthorUser,
				eq(commentAuthorUser.id, pullRequestComments.authorUserId)
			)
			.where(
				and(
					inArray(
						pullRequestComments.threadId,
						threads.map(thread => thread.id)
					),
					eq(pullRequestComments.state, 'published')
				)
			)
			.orderBy(asc(pullRequestComments.createdAt))

		return threads.map(thread => ({
			...thread,
			comments: comments.filter(comment => comment.threadId === thread.id),
		}))
	}
}
