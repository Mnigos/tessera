import { GitStorageClient } from '@config/git-storage'
import {
	type GitHubWriteThroughContext,
	GitHubWriteThroughService,
	toGitHubWriteThroughContext,
} from '@modules/github-write-through'
import {
	type GitHubWriteThroughTarget,
	RepositoriesService,
} from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedCreatePullRequestThreadInput,
	ParsedDeletePullRequestCommentInput,
	ParsedEditPullRequestCommentInput,
	ParsedGetPullRequestInput,
	ParsedListPullRequestThreadsInput,
	ParsedReplyPullRequestThreadInput,
	ParsedResolvePullRequestThreadInput,
	PullRequestComment,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadKind,
	PullRequestThreadPlacement,
	PullRequestThreadViewer,
} from '@repo/contracts'
import {
	canAdministerRepository,
	canWriteRepository,
	type PullRequestCommentId,
	type PullRequestId,
	type PullRequestReviewId,
	type PullRequestThreadId,
	type RepositoryId,
	type UserId,
} from '@repo/domain'
import {
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestPendingReviewConflictError } from '../domain/pull-request-review.errors'
import {
	classifyPullRequestThreadAnchor,
	isPullRequestThreadParticipant,
	type PullRequestThreadComparison,
	type PullRequestThreadComparisonFile,
	relocatePullRequestThreadAnchor,
	toPullRequestCommentOutput,
	toPullRequestThreadOutput,
} from '../domain/pull-request-thread'
import {
	PullRequestCommentForbiddenError,
	PullRequestCommentNotFoundError,
	PullRequestThreadNotFoundError,
	PullRequestThreadResolutionForbiddenError,
	PullRequestThreadUnpublishedError,
} from '../domain/pull-request-thread.errors'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestCommentContext,
	type PullRequestThreadReadModel,
	type PullRequestThreadResolutionResult,
	PullRequestThreadsRepository,
} from '../infrastructure/pull-request-threads.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'

export interface ListPullRequestThreadsResult {
	comparison: PullRequestThreadComparison
	threads: PullRequestThread[]
	viewer: PullRequestThreadViewer
}

interface PullRequestThreadContext {
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
}

/** A comparison plus the changed files anchoring reads; a mirror answers without them. */
interface PullRequestThreadComparisonSnapshot {
	comparison: PullRequestThreadComparison
	files?: PullRequestThreadComparisonFile[]
}

type PullRequestThreadPlacements = Map<
	PullRequestThreadId,
	PullRequestThreadPlacement
>

interface PullRequestThreadWriteContext extends PullRequestThreadContext {
	canAdminister: boolean
	canWrite: boolean
	gitHubTarget?: GitHubWriteThroughTarget
}

@Injectable()
export class PullRequestThreadsService {
	constructor(
		private readonly pullRequestThreadsRepository: PullRequestThreadsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient,
		private readonly gitHubWriteThroughService: GitHubWriteThroughService
	) {}

	async list(
		viewerUserId: UserId | undefined,
		{ number, path, slug, username }: ParsedListPullRequestThreadsInput
	): Promise<ListPullRequestThreadsResult> {
		const { repositoryId, storagePath, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const context = { pullRequest, repositoryId, storagePath }
		const [snapshot, threads] = await Promise.all([
			this.resolveComparison(context),
			this.pullRequestThreadsRepository.list({
				pullRequestId: pullRequest.id,
				path,
				viewerUserId,
			}),
		])
		const placements = await this.resolveThreadPlacements(
			threads,
			snapshot,
			context
		)
		const canComment = viewerUserId !== undefined

		return {
			threads: threads.map(thread =>
				toPullRequestThreadOutput(thread, placements.get(thread.id))
			),
			comparison: snapshot.comparison,
			viewer: {
				canComment,
				canResolveAnyThread: canComment && canWriteRepository(viewerRole),
				canDeleteAnyComment: canComment && canAdministerRepository(viewerRole),
			},
		}
	}

	async createThread(
		viewerUserId: UserId,
		{
			anchor,
			body,
			number,
			review,
			slug,
			username,
		}: ParsedCreatePullRequestThreadInput
	): Promise<PullRequestThread> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const snapshot = anchor
			? await this.requireAnchoredComparison(anchor, context)
			: undefined
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		// GitHub owns the review envelope, so the review marker has nothing to join.
		if (writeThrough) {
			const threadId = await this.gitHubWriteThroughService.createThread(
				writeThrough,
				{
					body,
					inline:
						anchor && snapshot
							? { anchor, headSha: snapshot.comparison.headSha }
							: undefined,
				}
			)

			return await this.toThreadOutput(
				await this.findThread(threadId, context.pullRequest.id, viewerUserId),
				context,
				snapshot
			)
		}

		const reviewId = await this.resolvePendingReviewId(
			viewerUserId,
			context,
			review
		)
		const thread = await this.pullRequestThreadsRepository.createThread({
			pullRequestId: context.pullRequest.id,
			authorUserId: viewerUserId,
			body,
			anchor,
			anchorBlobs: anchor && findComparisonFile(snapshot?.files, anchor.path),
			reviewId,
		})

		if (!thread)
			throw new PullRequestPendingReviewConflictError({
				pullRequestId: context.pullRequest.id,
				userId: viewerUserId,
			})

		return await this.toThreadOutput(thread, context, snapshot)
	}

	/** The comparison an anchor claims, refused once its lines number a moved head. */
	private async requireAnchoredComparison(
		anchor: PullRequestThreadAnchor,
		context: PullRequestThreadContext
	): Promise<PullRequestThreadComparisonSnapshot> {
		const snapshot = await this.resolveComparison(context)

		if (anchor.headSha !== snapshot.comparison.headSha)
			throw new PullRequestStaleComparisonError({
				pullRequestId: context.pullRequest.id,
				anchorHeadSha: anchor.headSha,
				headSha: snapshot.comparison.headSha,
			})

		return snapshot
	}

	async replyThread(
		viewerUserId: UserId,
		{
			body,
			number,
			review,
			slug,
			threadId,
			username,
		}: ParsedReplyPullRequestThreadInput
	): Promise<PullRequestThread> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})

		const existingThread = await this.findThread(
			threadId,
			context.pullRequest.id,
			viewerUserId
		)
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough) {
			await this.gitHubWriteThroughService.replyThread(writeThrough, {
				body,
				threadId,
				threadKind: existingThread.kind,
			})

			return await this.toThreadOutput(
				await this.findThread(threadId, context.pullRequest.id, viewerUserId),
				context
			)
		}

		const reviewId = await this.resolvePendingReviewId(
			viewerUserId,
			context,
			review
		)
		const thread = await this.pullRequestThreadsRepository.createComment({
			pullRequestId: context.pullRequest.id,
			threadId,
			authorUserId: viewerUserId,
			body,
			reviewId,
		})

		if (!thread)
			throw new PullRequestPendingReviewConflictError({
				pullRequestId: context.pullRequest.id,
				userId: viewerUserId,
			})

		return await this.toThreadOutput(thread, context)
	}

	async editComment(
		viewerUserId: UserId,
		{
			body,
			commentId,
			number,
			slug,
			username,
		}: ParsedEditPullRequestCommentInput
	): Promise<PullRequestComment> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const { pullRequest } = context
		const comment = await this.findComment(
			commentId,
			pullRequest.id,
			viewerUserId
		)

		if (comment.authorUserId !== viewerUserId)
			throw new PullRequestCommentForbiddenError({
				commentId,
				userId: viewerUserId,
				action: 'edit',
			})

		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough) {
			await this.gitHubWriteThroughService.editComment(writeThrough, {
				body,
				commentId,
			})

			return toPullRequestCommentOutput(
				await this.requireCommentReadModel(
					commentId,
					pullRequest.id,
					viewerUserId
				)
			)
		}

		const editedComment = await this.pullRequestThreadsRepository.editComment({
			commentId,
			body,
			editedAt: new Date(),
			viewerUserId,
		})

		if (!editedComment)
			throw new PullRequestCommentNotFoundError({
				commentId,
				pullRequestId: pullRequest.id,
			})

		return toPullRequestCommentOutput(editedComment)
	}

	async deleteComment(
		viewerUserId: UserId,
		{ commentId, number, slug, username }: ParsedDeletePullRequestCommentInput
	): Promise<{ threadDeleted: boolean }> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const { canAdminister, pullRequest } = context
		const comment = await this.findComment(
			commentId,
			pullRequest.id,
			viewerUserId
		)

		if (comment.authorUserId !== viewerUserId && !canAdminister)
			throw new PullRequestCommentForbiddenError({
				commentId,
				userId: viewerUserId,
				action: 'delete',
			})

		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return await this.gitHubWriteThroughService.deleteComment(writeThrough, {
				commentId,
				threadId: comment.threadId,
			})

		const threadDeleted = await this.pullRequestThreadsRepository.deleteComment(
			{
				commentId,
				threadId: comment.threadId,
			}
		)

		return { threadDeleted }
	}

	async resolveThread(
		viewerUserId: UserId,
		input: ParsedResolvePullRequestThreadInput
	): Promise<PullRequestThread> {
		const { context, thread } = await this.getResolvableThread(
			viewerUserId,
			input
		)
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return await this.resolveThroughGitHub(
				viewerUserId,
				context,
				writeThrough,
				{ resolved: true, threadId: thread.id, threadKind: thread.kind }
			)

		const result = await this.pullRequestThreadsRepository.resolveThread({
			pullRequestId: context.pullRequest.id,
			threadId: thread.id,
			actorUserId: viewerUserId,
			resolvedAt: new Date(),
		})

		return await this.toThreadOutput(
			this.requireResolvedThread(result, thread.id, context.pullRequest.id),
			context
		)
	}

	async unresolveThread(
		viewerUserId: UserId,
		input: ParsedResolvePullRequestThreadInput
	): Promise<PullRequestThread> {
		const { context, thread } = await this.getResolvableThread(
			viewerUserId,
			input
		)
		const writeThrough = this.toWriteThroughContext(viewerUserId, context)

		if (writeThrough)
			return await this.resolveThroughGitHub(
				viewerUserId,
				context,
				writeThrough,
				{ resolved: false, threadId: thread.id, threadKind: thread.kind }
			)

		const result = await this.pullRequestThreadsRepository.unresolveThread({
			pullRequestId: context.pullRequest.id,
			threadId: thread.id,
			actorUserId: viewerUserId,
		})

		return await this.toThreadOutput(
			this.requireResolvedThread(result, thread.id, context.pullRequest.id),
			context
		)
	}

	private async resolveThroughGitHub(
		viewerUserId: UserId,
		context: PullRequestThreadWriteContext,
		writeThrough: GitHubWriteThroughContext,
		params: {
			resolved: boolean
			threadId: PullRequestThreadId
			threadKind: PullRequestThreadKind
		}
	): Promise<PullRequestThread> {
		await this.gitHubWriteThroughService.setThreadResolution(
			writeThrough,
			params
		)

		return await this.toThreadOutput(
			await this.findThread(
				params.threadId,
				context.pullRequest.id,
				viewerUserId
			),
			context
		)
	}

	/**
	 * Reads the outcome of a resolution taken under the thread lock. The
	 * repository repeats the published-comment check there, so a comment deleted
	 * between the pre-check and the mutation surfaces as the same error the
	 * pre-check would have raised.
	 */
	private requireResolvedThread(
		result: PullRequestThreadResolutionResult,
		threadId: PullRequestThreadId,
		pullRequestId: PullRequestId
	): PullRequestThreadReadModel {
		if (result.status === 'thread_unpublished')
			throw new PullRequestThreadUnpublishedError({ threadId, pullRequestId })

		if (result.status === 'thread_not_found')
			throw new PullRequestThreadNotFoundError({ threadId, pullRequestId })

		return result.thread
	}

	private async getResolvableThread(
		viewerUserId: UserId,
		{ number, slug, threadId, username }: ParsedResolvePullRequestThreadInput
	): Promise<{
		context: PullRequestThreadWriteContext
		thread: PullRequestThreadReadModel
	}> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const thread = await this.findThread(
			threadId,
			context.pullRequest.id,
			viewerUserId
		)

		// Resolving is a public act that writes a timeline event, so a thread the
		// viewer only sees through their own pending draft has nothing to resolve
		// until the review is submitted.
		if (!thread.comments.some(comment => comment.state === 'published'))
			throw new PullRequestThreadUnpublishedError({
				threadId,
				pullRequestId: context.pullRequest.id,
			})

		if (
			!(
				context.canWrite || isPullRequestThreadParticipant(thread, viewerUserId)
			)
		)
			throw new PullRequestThreadResolutionForbiddenError({
				threadId,
				userId: viewerUserId,
			})

		return { context, thread }
	}

	/**
	 * Joins the comment to the viewer's pending review, starting one when needed.
	 * The review keeps the head SHA it was started from, so a later marker with a
	 * different SHA does not move it.
	 */
	private async resolvePendingReviewId(
		viewerUserId: UserId,
		{ pullRequest }: PullRequestThreadWriteContext,
		review: { expectedHeadSha: string } | undefined
	): Promise<PullRequestReviewId | undefined> {
		if (!review) return undefined

		if (pullRequest.state !== 'open')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'review',
			})

		const reviewId =
			await this.pullRequestReviewsRepository.getOrCreatePendingReview({
				pullRequestId: pullRequest.id,
				reviewerUserId: viewerUserId,
				headSha: review.expectedHeadSha,
			})

		if (!reviewId)
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'review',
			})

		return reviewId
	}

	private async getWriteContext(
		viewerUserId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestThreadWriteContext> {
		const { gitHubTarget, repositoryId, storagePath, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)

		return {
			pullRequest,
			repositoryId,
			storagePath,
			gitHubTarget,
			canWrite: canWriteRepository(viewerRole),
			canAdminister: canAdministerRepository(viewerRole),
		}
	}

	private toWriteThroughContext(
		viewerUserId: UserId,
		{ gitHubTarget, pullRequest, repositoryId }: PullRequestThreadWriteContext
	): GitHubWriteThroughContext | undefined {
		return toGitHubWriteThroughContext(viewerUserId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})
	}

	private async toThreadOutput(
		thread: PullRequestThreadReadModel,
		context: PullRequestThreadContext,
		resolved?: PullRequestThreadComparisonSnapshot
	): Promise<PullRequestThread> {
		if (thread.kind !== 'inline') return toPullRequestThreadOutput(thread)

		const snapshot = resolved ?? (await this.resolveComparison(context))
		const placements = await this.resolveThreadPlacements(
			[thread],
			snapshot,
			context
		)

		return toPullRequestThreadOutput(thread, placements.get(thread.id))
	}

	/** Where each inline thread sits now: the changed files answer for most of them, the rest cost one file diff per path and never one per thread. */
	private async resolveThreadPlacements(
		threads: PullRequestThreadReadModel[],
		snapshot: PullRequestThreadComparisonSnapshot,
		context: PullRequestThreadContext
	): Promise<PullRequestThreadPlacements> {
		const placements: PullRequestThreadPlacements = new Map()
		const relocations = new Map<string, PullRequestThreadReadModel[]>()

		for (const thread of threads) {
			const classification = classifyPullRequestThreadAnchor(
				thread,
				snapshot.comparison,
				snapshot.files
			)

			if (classification.kind === 'current')
				placements.set(thread.id, classification.placement)

			if (classification.kind === 'relocate')
				relocations.set(classification.path, [
					...(relocations.get(classification.path) ?? []),
					thread,
				])
		}

		await Promise.all(
			[...relocations].map(async ([path, pathThreads]) => {
				const lines = await this.readComparisonLines(
					context,
					snapshot.comparison,
					path
				)

				for (const thread of pathThreads) {
					const placement = relocatePullRequestThreadAnchor(thread, lines)

					if (placement) placements.set(thread.id, placement)
				}
			})
		)

		return placements
	}

	private async readComparisonLines(
		{ repositoryId, storagePath }: PullRequestThreadContext,
		{ baseSha, headSha }: PullRequestThreadComparison,
		path: string
	) {
		try {
			const diff = await this.gitStorageClient.getRepositoryFileDiff({
				repositoryId,
				storagePath,
				baseRef: baseSha,
				headRef: headSha,
				path,
			})

			return diff.hunks.flatMap(hunk => hunk.lines)
		} catch {
			return []
		}
	}

	private async resolveComparison({
		pullRequest,
		repositoryId,
		storagePath,
	}: PullRequestThreadContext): Promise<PullRequestThreadComparisonSnapshot> {
		if (pullRequest.github)
			return {
				comparison: {
					baseSha: pullRequest.github.baseSha,
					headSha: pullRequest.github.headSha,
				},
			}

		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)
		const { baseSha, files, headSha } =
			await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef,
				headRef,
			})

		return { comparison: { baseSha, headSha }, files }
	}

	private async findThread(
		threadId: PullRequestThreadId,
		pullRequestId: PullRequestId,
		viewerUserId: UserId
	): Promise<PullRequestThreadReadModel> {
		const thread = await this.pullRequestThreadsRepository.findThread({
			threadId,
			viewerUserId,
		})

		if (!thread || thread.pullRequestId !== pullRequestId)
			throw new PullRequestThreadNotFoundError({ threadId, pullRequestId })

		return thread
	}

	private async requireCommentReadModel(
		commentId: PullRequestCommentId,
		pullRequestId: PullRequestId,
		viewerUserId: UserId
	) {
		const comment =
			await this.pullRequestThreadsRepository.findCommentReadModel({
				commentId,
				viewerUserId,
			})

		if (!comment)
			throw new PullRequestCommentNotFoundError({ commentId, pullRequestId })

		return comment
	}

	private async findComment(
		commentId: PullRequestCommentId,
		pullRequestId: PullRequestId,
		viewerUserId: UserId
	): Promise<PullRequestCommentContext> {
		const comment = await this.pullRequestThreadsRepository.findComment({
			commentId,
			viewerUserId,
		})

		if (!comment || comment.pullRequestId !== pullRequestId)
			throw new PullRequestCommentNotFoundError({ commentId, pullRequestId })

		return comment
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

/** The changed file a thread's path belongs to, whichever side of a rename it names. */
function findComparisonFile(
	files: PullRequestThreadComparisonFile[] | undefined,
	path: string
) {
	return files?.find(file => file.newPath === path || file.oldPath === path)
}
