import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
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
	PullRequestThreadViewer,
} from '@repo/contracts'
import {
	canAdministerRepository,
	canWriteRepository,
	type PullRequestCommentId,
	type PullRequestId,
	type PullRequestThreadId,
	type RepositoryId,
	type UserId,
} from '@repo/domain'
import { PullRequestNotFoundError } from '../domain/pull-request.errors'
import {
	isPullRequestThreadOutdated,
	isPullRequestThreadParticipant,
	type PullRequestThreadComparison,
	toPullRequestCommentOutput,
	toPullRequestThreadOutput,
} from '../domain/pull-request-thread'
import {
	PullRequestCommentForbiddenError,
	PullRequestCommentNotFoundError,
	PullRequestThreadNotFoundError,
	PullRequestThreadResolutionForbiddenError,
} from '../domain/pull-request-thread.errors'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import {
	type PullRequestCommentContext,
	type PullRequestThreadReadModel,
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

interface PullRequestThreadWriteContext extends PullRequestThreadContext {
	canAdminister: boolean
	canWrite: boolean
}

@Injectable()
export class PullRequestThreadsService {
	constructor(
		private readonly pullRequestThreadsRepository: PullRequestThreadsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async list(
		viewerUserId: UserId | undefined,
		{ number, path, slug, username }: ParsedListPullRequestThreadsInput
	): Promise<ListPullRequestThreadsResult> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const [comparison, threads] = await Promise.all([
			this.resolveComparison({ pullRequest, repositoryId, storagePath }),
			this.pullRequestThreadsRepository.list({
				pullRequestId: pullRequest.id,
				path,
			}),
		])
		const canComment = viewerUserId !== undefined && tesseraWritesAllowed

		return {
			threads: threads.map(thread =>
				toPullRequestThreadOutput(
					thread,
					isPullRequestThreadOutdated(thread, comparison)
				)
			),
			comparison,
			viewer: {
				canComment,
				canResolveAnyThread: canComment && canWriteRepository(viewerRole),
				canDeleteAnyComment: canComment && canAdministerRepository(viewerRole),
			},
		}
	}

	async createThread(
		viewerUserId: UserId,
		{ anchor, body, number, slug, username }: ParsedCreatePullRequestThreadInput
	): Promise<PullRequestThread> {
		const context = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const thread = await this.pullRequestThreadsRepository.createThread({
			pullRequestId: context.pullRequest.id,
			authorUserId: viewerUserId,
			body,
			anchor,
		})

		return await this.toThreadOutput(thread, context)
	}

	async replyThread(
		viewerUserId: UserId,
		{
			body,
			number,
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

		await this.findThread(threadId, context.pullRequest.id)

		const thread = await this.pullRequestThreadsRepository.createComment({
			pullRequestId: context.pullRequest.id,
			threadId,
			authorUserId: viewerUserId,
			body,
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
		const { pullRequest } = await this.getWriteContext(viewerUserId, {
			number,
			slug,
			username,
		})
		const comment = await this.findComment(commentId, pullRequest.id)

		if (comment.authorUserId !== viewerUserId)
			throw new PullRequestCommentForbiddenError({
				commentId,
				userId: viewerUserId,
				action: 'edit',
			})

		const editedComment = await this.pullRequestThreadsRepository.editComment({
			commentId,
			body,
			editedAt: new Date(),
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
		const { canAdminister, pullRequest } = await this.getWriteContext(
			viewerUserId,
			{ number, slug, username }
		)
		const comment = await this.findComment(commentId, pullRequest.id)

		if (comment.authorUserId !== viewerUserId && !canAdminister)
			throw new PullRequestCommentForbiddenError({
				commentId,
				userId: viewerUserId,
				action: 'delete',
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
		const resolvedThread =
			await this.pullRequestThreadsRepository.resolveThread({
				pullRequestId: context.pullRequest.id,
				threadId: thread.id,
				actorUserId: viewerUserId,
				resolvedAt: new Date(),
			})

		return await this.toThreadOutput(resolvedThread, context)
	}

	async unresolveThread(
		viewerUserId: UserId,
		input: ParsedResolvePullRequestThreadInput
	): Promise<PullRequestThread> {
		const { context, thread } = await this.getResolvableThread(
			viewerUserId,
			input
		)
		const unresolvedThread =
			await this.pullRequestThreadsRepository.unresolveThread({
				pullRequestId: context.pullRequest.id,
				threadId: thread.id,
				actorUserId: viewerUserId,
			})

		return await this.toThreadOutput(unresolvedThread, context)
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
		const thread = await this.findThread(threadId, context.pullRequest.id)

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

	private async getWriteContext(
		viewerUserId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestThreadWriteContext> {
		const { repositoryId, storagePath, viewerRole } =
			await this.repositoriesService.getReadableTesseraRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)

		return {
			pullRequest,
			repositoryId,
			storagePath,
			canWrite: canWriteRepository(viewerRole),
			canAdminister: canAdministerRepository(viewerRole),
		}
	}

	private async toThreadOutput(
		thread: PullRequestThreadReadModel,
		context: PullRequestThreadContext
	): Promise<PullRequestThread> {
		if (thread.kind !== 'inline')
			return toPullRequestThreadOutput(thread, false)

		const comparison = await this.resolveComparison(context)

		return toPullRequestThreadOutput(
			thread,
			isPullRequestThreadOutdated(thread, comparison)
		)
	}

	private async resolveComparison({
		pullRequest,
		repositoryId,
		storagePath,
	}: PullRequestThreadContext): Promise<PullRequestThreadComparison> {
		if (pullRequest.github)
			return {
				baseSha: pullRequest.github.baseSha,
				headSha: pullRequest.github.headSha,
			}

		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)
		const { baseSha, headSha } =
			await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef,
				headRef,
			})

		return { baseSha, headSha }
	}

	private async findThread(
		threadId: PullRequestThreadId,
		pullRequestId: PullRequestId
	): Promise<PullRequestThreadReadModel> {
		const thread = await this.pullRequestThreadsRepository.findThread({
			threadId,
		})

		if (!thread || thread.pullRequestId !== pullRequestId)
			throw new PullRequestThreadNotFoundError({ threadId, pullRequestId })

		return thread
	}

	private async findComment(
		commentId: PullRequestCommentId,
		pullRequestId: PullRequestId
	): Promise<PullRequestCommentContext> {
		const comment = await this.pullRequestThreadsRepository.findComment({
			commentId,
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
