import { hasGitHubRepoScope } from '@modules/github-import/helpers/github-import.helpers'
import { Injectable, Logger } from '@nestjs/common'
import type {
	MergeStrategy,
	PullRequestReviewOutcome,
	PullRequestThreadAnchor,
	PullRequestThreadKind,
} from '@repo/contracts'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import {
	GitHubRateLimitedError,
	GitHubReconnectRequiredError,
	GitHubResponseUnreadableError,
	GitHubSyncDelayedError,
	GitHubUnavailableError,
	GitHubWriteForbiddenError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'
import {
	GitHubUserWriteClient,
	type GitHubUserWriteTarget,
} from '../infrastructure/github-user-write.client'
import {
	type GitHubPullRequestWriteTarget,
	GitHubWriteThroughRepository,
} from '../infrastructure/github-write-through.repository'

export interface GitHubWriteThroughContext {
	actorUserId: UserId
	externalRepository: { name: string; ownerLogin: string }
	pullRequestId: PullRequestId
	repositoryId: RepositoryId
}

/** Absent unless GitHub owns the write side, which keeps the native path native. */
export function toGitHubWriteThroughContext(
	actorUserId: UserId,
	{
		gitHubTarget,
		pullRequestId,
		repositoryId,
	}: {
		gitHubTarget?: GitHubWriteThroughContext['externalRepository']
		pullRequestId: PullRequestId
		repositoryId: RepositoryId
	}
): GitHubWriteThroughContext | undefined {
	if (!gitHubTarget) return undefined

	return {
		actorUserId,
		externalRepository: gitHubTarget,
		pullRequestId,
		repositoryId,
	}
}

interface ResolvedWriteTarget extends GitHubUserWriteTarget {
	pullRequestNumber: number
	target: GitHubPullRequestWriteTarget
}

interface CreateThreadParams {
	anchor?: PullRequestThreadAnchor
	body: string
}

interface ReplyThreadParams {
	body: string
	threadId: PullRequestThreadId
	threadKind: PullRequestThreadKind
}

interface CommentParams {
	commentId: PullRequestCommentId
}

interface EditCommentParams extends CommentParams {
	body: string
}

interface DeleteCommentParams extends CommentParams {
	threadId: PullRequestThreadId
}

interface ThreadResolutionParams {
	resolved: boolean
	threadId: PullRequestThreadId
	threadKind: PullRequestThreadKind
}

interface ReviewerParams {
	reviewerUserId: UserId
}

interface SubmitReviewParams {
	body: string
	expectedHeadSha: string
	outcome: PullRequestReviewOutcome
}

interface UpdatePullRequestParams {
	body?: string
	state?: 'open' | 'closed'
	targetBranch?: string
	title?: string
}

interface MergeParams {
	expectedHeadSha: string
	strategy: MergeStrategy
}

/** Errors that mean GitHub never took the write, so nothing local needs recovering. */
const WRITE_REFUSALS = [
	GitHubRateLimitedError,
	GitHubReconnectRequiredError,
	GitHubUnavailableError,
	GitHubWriteForbiddenError,
	GitHubWriteRejectedError,
]

@Injectable()
export class GitHubWriteThroughService {
	private readonly logger = new Logger(GitHubWriteThroughService.name)

	constructor(
		private readonly gitHubUserWriteClient: GitHubUserWriteClient,
		private readonly gitHubWriteThroughRepository: GitHubWriteThroughRepository
	) {}

	async createThread(
		context: GitHubWriteThroughContext,
		{ anchor, body }: CreateThreadParams
	): Promise<PullRequestThreadId> {
		const resolved = await this.resolveWriteTarget(context)

		return await this.echo(context, async () => {
			if (!anchor) {
				const comment = await this.gitHubUserWriteClient.createIssueComment({
					...resolved,
					body,
				})

				return await this.gitHubWriteThroughRepository.echoIssueComment({
					...this.toEchoParams(context, resolved),
					comment,
				})
			}

			const comment = await this.gitHubUserWriteClient.createReviewComment({
				...resolved,
				anchor,
				body,
			})

			return await this.gitHubWriteThroughRepository.echoReviewComment({
				...this.toEchoParams(context, resolved),
				anchor,
				comment,
			})
		})
	}

	async replyThread(
		context: GitHubWriteThroughContext,
		{ body, threadId, threadKind }: ReplyThreadParams
	): Promise<void> {
		if (threadKind === 'top_level')
			throw new GitHubWriteRejectedError('top_level_reply_unsupported', {
				threadId,
			})

		const resolved = await this.resolveWriteTarget(context)
		const thread = await this.gitHubWriteThroughRepository.findThreadTarget({
			threadId,
		})

		const rootCommentNumericId = thread?.rootCommentNumericId

		if (!(thread && rootCommentNumericId))
			throw new GitHubWriteRejectedError('missing_mapping', { threadId })

		await this.echo(context, async () => {
			const comment =
				await this.gitHubUserWriteClient.createReplyForReviewComment({
					...resolved,
					body,
					rootCommentNumericId,
				})

			await this.gitHubWriteThroughRepository.echoReply({
				...this.toEchoParams(context, resolved),
				comment,
				threadId,
				threadMappingId: thread.threadMappingId,
			})
		})
	}

	async editComment(
		context: GitHubWriteThroughContext,
		{ body, commentId }: EditCommentParams
	): Promise<void> {
		const resolved = await this.resolveWriteTarget(context)
		const comment = await this.findCommentTarget(commentId)

		await this.echo(context, async () => {
			const updated =
				comment.kind === 'issue'
					? await this.gitHubUserWriteClient.updateIssueComment({
							...resolved,
							body,
							commentNumericId: comment.externalNumericId,
						})
					: await this.gitHubUserWriteClient.updateReviewComment({
							...resolved,
							body,
							commentNumericId: comment.externalNumericId,
						})

			await this.gitHubWriteThroughRepository.echoCommentEdit({
				...this.toEchoParams(context, resolved),
				body: updated.body,
				commentId,
				updatedAt: updated.updatedAt,
			})
		})
	}

	async deleteComment(
		context: GitHubWriteThroughContext,
		{ commentId, threadId }: DeleteCommentParams
	): Promise<{ threadDeleted: boolean }> {
		const resolved = await this.resolveWriteTarget(context)
		const comment = await this.findCommentTarget(commentId)

		return await this.echo(context, async () => {
			if (comment.kind === 'issue')
				await this.gitHubUserWriteClient.deleteIssueComment({
					...resolved,
					commentNumericId: comment.externalNumericId,
				})
			else
				await this.gitHubUserWriteClient.deleteReviewComment({
					...resolved,
					commentNumericId: comment.externalNumericId,
				})

			return await this.gitHubWriteThroughRepository.echoCommentDeletion({
				...this.toEchoParams(context, resolved),
				commentId,
				threadId,
			})
		})
	}

	async setThreadResolution(
		context: GitHubWriteThroughContext,
		{ resolved: shouldResolve, threadId, threadKind }: ThreadResolutionParams
	): Promise<void> {
		if (threadKind === 'top_level')
			throw new GitHubWriteRejectedError('thread_not_resolvable', { threadId })

		const resolved = await this.resolveWriteTarget(context)
		const thread = await this.gitHubWriteThroughRepository.findThreadTarget({
			threadId,
		})
		const threadNodeId = thread?.externalNodeId

		if (!(thread && threadNodeId))
			throw new GitHubWriteRejectedError('missing_mapping', { threadId })

		await this.echo(context, async () => {
			const threadTarget = { ...resolved, threadNodeId }

			if (shouldResolve)
				await this.gitHubUserWriteClient.resolveReviewThread(threadTarget)
			else await this.gitHubUserWriteClient.unresolveReviewThread(threadTarget)

			await this.gitHubWriteThroughRepository.echoThreadResolution({
				...this.toEchoParams(context, resolved),
				resolved: shouldResolve,
				threadId,
				threadMappingId: thread.threadMappingId,
				threadNodeId,
			})
		})
	}

	async requestReviewer(
		context: GitHubWriteThroughContext,
		{ reviewerUserId }: ReviewerParams
	): Promise<PullRequestReviewerRequestId> {
		const resolved = await this.resolveWriteTarget(context)
		const reviewer = await this.findReviewerIdentity(reviewerUserId)

		return await this.echo(context, async () => {
			await this.gitHubUserWriteClient.requestReviewer({
				...resolved,
				reviewerLogin: reviewer.login,
			})

			return await this.gitHubWriteThroughRepository.echoReviewerRequest({
				...this.toEchoParams(context, resolved),
				reviewer,
				reviewerUserId,
			})
		})
	}

	async removeReviewerRequest(
		context: GitHubWriteThroughContext,
		{ reviewerUserId }: ReviewerParams
	): Promise<boolean> {
		const resolved = await this.resolveWriteTarget(context)
		const reviewer = await this.findReviewerIdentity(reviewerUserId)

		return await this.echo(context, async () => {
			await this.gitHubUserWriteClient.removeRequestedReviewer({
				...resolved,
				reviewerLogin: reviewer.login,
			})

			return await this.gitHubWriteThroughRepository.echoReviewerRequestRemoval(
				{ ...this.toEchoParams(context, resolved), reviewerUserId }
			)
		})
	}

	async submitReview(
		context: GitHubWriteThroughContext,
		{ body, expectedHeadSha, outcome }: SubmitReviewParams
	): Promise<PullRequestReviewId> {
		if (outcome !== 'approve' && !body.trim())
			throw new GitHubWriteRejectedError('review_body_required', {
				pullRequestId: context.pullRequestId,
			})

		const resolved = await this.resolveWriteTarget(context)

		return await this.echo(context, async () => {
			const review = await this.gitHubUserWriteClient.createReview({
				...resolved,
				body,
				outcome,
			})

			return await this.gitHubWriteThroughRepository.echoReview({
				...this.toEchoParams(context, resolved),
				headSha: expectedHeadSha,
				review,
			})
		})
	}

	async updatePullRequest(
		context: GitHubWriteThroughContext,
		{ body, state, targetBranch, title }: UpdatePullRequestParams
	): Promise<void> {
		const resolved = await this.resolveWriteTarget(context)

		await this.echo(context, async () => {
			const pullRequest = await this.gitHubUserWriteClient.updatePullRequest({
				...resolved,
				body,
				state,
				targetBranch,
				title,
			})

			await this.gitHubWriteThroughRepository.echoPullRequest({
				pullRequest,
				pullRequestId: context.pullRequestId,
				repositoryId: context.repositoryId,
			})
		})
	}

	async mergePullRequest(
		context: GitHubWriteThroughContext,
		{ expectedHeadSha, strategy }: MergeParams
	): Promise<void> {
		if (strategy === 'fast_forward')
			throw new GitHubWriteRejectedError('fast_forward_unsupported', {
				pullRequestId: context.pullRequestId,
			})

		const resolved = await this.resolveWriteTarget(context)

		await this.echo(context, async () => {
			const mergeCommitSha = await this.gitHubUserWriteClient.mergePullRequest({
				...resolved,
				expectedHeadSha,
				strategy,
			})

			// The merge is done; a failed read-back is a delay, never a refusal.
			const pullRequest = await this.gitHubUserWriteClient
				.getPullRequest(resolved)
				.catch((error: unknown) => {
					throw new GitHubResponseUnreadableError({
						cause: String(error),
						pullRequestId: context.pullRequestId,
					})
				})

			await this.gitHubWriteThroughRepository.echoPullRequest({
				mergeCommitSha,
				pullRequest,
				pullRequestId: context.pullRequestId,
				repositoryId: context.repositoryId,
			})
		})
	}

	private async resolveWriteTarget({
		actorUserId,
		externalRepository,
		pullRequestId,
	}: GitHubWriteThroughContext): Promise<ResolvedWriteTarget> {
		const account = await this.gitHubWriteThroughRepository.findGitHubAccount({
			userId: actorUserId,
		})

		if (!account?.accessToken)
			throw new GitHubReconnectRequiredError({
				reason: 'missing_token',
				userId: actorUserId,
			})

		if (account.scope?.trim() && !hasGitHubRepoScope(account.scope))
			throw new GitHubReconnectRequiredError({
				reason: 'missing_repo_scope',
				userId: actorUserId,
			})

		if (
			account.accessTokenExpiresAt &&
			account.accessTokenExpiresAt.getTime() <= Date.now()
		)
			throw new GitHubReconnectRequiredError({
				reason: 'expired_token',
				userId: actorUserId,
			})

		const target =
			await this.gitHubWriteThroughRepository.findPullRequestTarget({
				pullRequestId,
			})

		if (!target)
			throw new GitHubWriteRejectedError('missing_mapping', { pullRequestId })

		return {
			accessToken: account.accessToken,
			owner: externalRepository.ownerLogin,
			repo: externalRepository.name,
			pullRequestNumber: target.externalNumber,
			target,
		}
	}

	private async findCommentTarget(commentId: PullRequestCommentId) {
		const comment = await this.gitHubWriteThroughRepository.findCommentTarget({
			commentId,
		})

		if (!comment)
			throw new GitHubWriteRejectedError('missing_mapping', { commentId })

		return comment
	}

	private async findReviewerIdentity(reviewerUserId: UserId) {
		const reviewer = await this.gitHubWriteThroughRepository.findUserIdentity({
			userId: reviewerUserId,
		})

		if (!reviewer)
			throw new GitHubWriteRejectedError('reviewer_not_on_github', {
				reviewerUserId,
			})

		return reviewer
	}

	private toEchoParams(
		{ actorUserId, pullRequestId, repositoryId }: GitHubWriteThroughContext,
		{ target }: ResolvedWriteTarget
	) {
		return { actorUserId, pullRequestId, repositoryId, target }
	}

	/** Past here GitHub may already hold the write, so only a refusal it named rethrows. */
	private async echo<T>(
		{ pullRequestId, repositoryId }: GitHubWriteThroughContext,
		run: () => Promise<T>
	): Promise<T> {
		try {
			return await run()
		} catch (error) {
			if (WRITE_REFUSALS.some(refusal => error instanceof refusal)) throw error

			this.logger.error(
				`GitHub accepted a write on pull request ${pullRequestId} but its Tessera echo failed: ${String(error)}`
			)
			await this.gitHubWriteThroughRepository
				.requestSync({ repositoryId })
				.catch((syncError: unknown) =>
					this.logger.error(
						`Failed to request the reconciliation that would recover pull request ${pullRequestId}: ${String(syncError)}`
					)
				)

			throw new GitHubSyncDelayedError({ pullRequestId, repositoryId })
		}
	}
}
