import { createHash } from 'node:crypto'
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
	type BatchedReviewDraft,
	type GitHubPullRequestWriteTarget,
	type GitHubReviewSubmissionLedgerEntry,
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
	body: string
	/** Absent on a top-level comment, which hangs off no commit of its own. */
	inline?: {
		anchor: PullRequestThreadAnchor
		/** The head Tessera resolved, which outranks the head the caller claimed. */
		headSha: string
	}
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
	/** The batched drafts, which travel to GitHub as one review rather than one comment each. */
	drafts: readonly BatchedReviewDraft[]
	expectedHeadSha: string
	outcome: PullRequestReviewOutcome
	/** The pending envelope being sealed; absent when the reviewer batched nothing. */
	pendingReviewId?: PullRequestReviewId
	/** Comments the review already carries, which is what makes a body optional. */
	pendingCommentCount: number
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
		{ body, inline }: CreateThreadParams
	): Promise<PullRequestThreadId> {
		// A range that ends before it starts is one GitHub cannot hang a comment on.
		if (inline && inline.anchor.startLine > inline.anchor.endLine)
			throw new GitHubWriteRejectedError('invalid_anchor', {
				path: inline.anchor.path,
			})

		const resolved = await this.resolveWriteTarget(context)

		return await this.echo(context, async () => {
			if (!inline) {
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
				...inline,
				body,
			})

			return await this.gitHubWriteThroughRepository.echoReviewComment({
				...this.toEchoParams(context, resolved),
				anchor: inline.anchor,
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

	/**
	 * The whole review in one GitHub call: the body, the verdict, and every
	 * batched draft as a comment on the array `pulls.createReview` validates
	 * atomically. A ledger row stands in for the idempotency key GitHub does not
	 * offer, so an attempt whose answer was lost adopts the review it may already
	 * have created instead of leaving a second one.
	 */
	async submitReview(
		context: GitHubWriteThroughContext,
		{
			body,
			drafts,
			expectedHeadSha,
			outcome,
			pendingCommentCount,
			pendingReviewId,
		}: SubmitReviewParams
	): Promise<PullRequestReviewId> {
		if (outcome !== 'approve' && !body.trim() && pendingCommentCount === 0)
			throw new GitHubWriteRejectedError('review_body_required', {
				pullRequestId: context.pullRequestId,
			})

		const resolved = await this.resolveWriteTarget(context)

		// The head the reviewer read has to still be the head GitHub holds, or the
		// comments would land on lines they never saw.
		if (resolved.target.headSha && resolved.target.headSha !== expectedHeadSha)
			throw new GitHubWriteRejectedError('stale_head', {
				expectedHeadSha,
				headSha: resolved.target.headSha,
				pullRequestId: context.pullRequestId,
			})

		const submission =
			await this.gitHubWriteThroughRepository.startReviewSubmission({
				actorUserId: context.actorUserId,
				commentCount: drafts.length,
				expectedHeadSha,
				idempotencyKey: toReviewSubmissionKey({
					actorUserId: context.actorUserId,
					body,
					expectedHeadSha,
					outcome,
					pullRequestId: context.pullRequestId,
				}),
				pullRequestId: context.pullRequestId,
				reviewId: pendingReviewId,
			})

		if (submission.settledReviewId) return submission.settledReviewId

		return await this.echo(context, async () => {
			const { isAdopted, review } = await this.createOrAdoptReview(resolved, {
				actorUserId: context.actorUserId,
				body,
				drafts,
				expectedHeadSha,
				outcome,
				submission,
			})
			const comments =
				drafts.length > 0
					? await this.gitHubUserWriteClient.listReviewComments({
							...resolved,
							reviewNumericId: review.numericId,
						})
					: []

			return await this.gitHubWriteThroughRepository.echoBatchedReview({
				...this.toEchoParams(context, resolved),
				comments,
				drafts,
				headSha: expectedHeadSha,
				isAdopted,
				pendingReviewId,
				review,
				submissionId: submission.id,
			})
		})
	}

	private async createOrAdoptReview(
		resolved: ResolvedWriteTarget,
		{
			actorUserId,
			body,
			drafts,
			expectedHeadSha,
			outcome,
			submission,
		}: Omit<SubmitReviewParams, 'pendingCommentCount' | 'pendingReviewId'> & {
			actorUserId: UserId
			submission: GitHubReviewSubmissionLedgerEntry
		}
	) {
		const adopted = submission.isUnresolved
			? await this.findPostedReview(resolved, {
					actorUserId,
					expectedHeadSha,
					outcome,
					submission,
				})
			: undefined

		if (adopted) return { isAdopted: true, review: adopted }

		try {
			const review = await this.gitHubUserWriteClient.createReview({
				...resolved,
				body,
				comments: drafts,
				expectedHeadSha,
				outcome,
			})

			await this.gitHubWriteThroughRepository.recordReviewSubmissionPosted({
				externalReviewNodeId: review.nodeId,
				externalReviewNumericId: review.numericId,
				submissionId: submission.id,
			})

			return { isAdopted: false, review }
		} catch (error) {
			const rejection = toBatchedReviewRejection(error, drafts.length)

			// Only a refusal GitHub named leaves nothing behind; anything else may
			// still hold the review, and the ledger has to stay claimable.
			if (WRITE_REFUSALS.some(refusal => rejection instanceof refusal))
				await this.gitHubWriteThroughRepository
					.failReviewSubmission({
						lastErrorCode:
							rejection instanceof GitHubWriteRejectedError
								? rejection.reason
								: 'refused',
						submissionId: submission.id,
					})
					.catch((ledgerError: unknown) =>
						this.logger.error(
							`Failed to record the outcome of review submission ${submission.id}: ${String(ledgerError)}`
						)
					)

			throw rejection
		}
	}

	/**
	 * The review a previous attempt may already have created. GitHub answers a
	 * lost request with nothing at all, so the reviewer's own submissions since
	 * the attempt opened are the only evidence there is.
	 */
	private async findPostedReview(
		resolved: ResolvedWriteTarget,
		{
			actorUserId,
			expectedHeadSha,
			outcome,
			submission,
		}: {
			actorUserId: UserId
			expectedHeadSha: string
			outcome: PullRequestReviewOutcome
			submission: GitHubReviewSubmissionLedgerEntry
		}
	) {
		const reviewer = await this.gitHubWriteThroughRepository.findUserIdentity({
			userId: actorUserId,
		})

		if (!reviewer) return undefined

		const reviews = await this.gitHubUserWriteClient.listOwnReviewsSince({
			...resolved,
			reviewerLogin: reviewer.login,
			since: submission.createdAt,
		})
		const candidates = reviews.filter(
			review =>
				review.outcome === outcome &&
				(review.commitId ?? expectedHeadSha) === expectedHeadSha
		)
		// A review the mirror already ingested has its own rows; claiming it here
		// would hang a second review off the same node id.
		const mapped =
			await this.gitHubWriteThroughRepository.findMappedReviewNodeIds({
				nodeIds: candidates.map(review => review.nodeId),
			})
		const unmapped = candidates.filter(review => !mapped.has(review.nodeId))

		return (
			unmapped.find(
				review => review.nodeId === submission.externalReviewNodeId
			) ?? unmapped.at(-1)
		)
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

/**
 * The key one submission attempt is remembered by. GitHub takes no idempotency
 * key, so the payload is the identity: a retry repeats it exactly, and a second
 * opinion never does. The pending review is deliberately not part of it — a
 * retry that follows a submission GitHub already took finds no pending review
 * left to name, and would otherwise hash to a key of its own.
 */
function toReviewSubmissionKey({
	actorUserId,
	body,
	expectedHeadSha,
	outcome,
	pullRequestId,
}: {
	actorUserId: UserId
	body: string
	expectedHeadSha: string
	outcome: PullRequestReviewOutcome
	pullRequestId: PullRequestId
}): string {
	return createHash('sha256')
		.update(
			[pullRequestId, actorUserId, expectedHeadSha, outcome, body].join(
				'\u0000'
			)
		)
		.digest('hex')
}

/** A batch GitHub refused names the batch, not the single comment it never took. */
function toBatchedReviewRejection(error: unknown, draftCount: number): unknown {
	if (
		draftCount > 0 &&
		error instanceof GitHubWriteRejectedError &&
		error.reason === 'invalid_anchor'
	)
		return new GitHubWriteRejectedError('unanchorable_comment', {
			action: 'review',
			draftCount,
		})

	return error
}
