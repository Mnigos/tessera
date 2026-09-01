import {
	gitHubIssueCommentSchema,
	gitHubPullRequestSchema,
	gitHubReviewCommentSchema,
	gitHubReviewSchema,
	toGitHubSyncIssueComment,
	toGitHubSyncPullRequest,
	toGitHubSyncReview,
	toGitHubSyncReviewComment,
} from '@modules/github-sync/infrastructure/github-rest.mappers'
import type {
	GitHubSyncIssueComment,
	GitHubSyncPullRequest,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewOutcome,
} from '@modules/github-sync/infrastructure/github-sync.client.types'
import { Injectable } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import type { MergeStrategy, PullRequestThreadAnchor } from '@repo/contracts'
import { z } from 'zod'
import {
	GitHubResponseUnreadableError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'
import {
	type GitHubWriteAction,
	toGitHubWriteError,
} from '../helpers/github-write-through-failure'

const RESOLVE_REVIEW_THREAD_MUTATION = `
	mutation ResolveReviewThread($threadId: ID!) {
		resolveReviewThread(input: { threadId: $threadId }) {
			thread { id }
		}
	}
`
const UNRESOLVE_REVIEW_THREAD_MUTATION = `
	mutation UnresolveReviewThread($threadId: ID!) {
		unresolveReviewThread(input: { threadId: $threadId }) {
			thread { id }
		}
	}
`

const REVIEW_EVENTS: Record<
	GitHubSyncReviewOutcome,
	'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
> = {
	approve: 'APPROVE',
	request_changes: 'REQUEST_CHANGES',
	comment: 'COMMENT',
}

// GitHub caps a page at 100, and a batched review never approaches it.
const REVIEW_COMMENT_PAGE_SIZE = 100

const gitHubMergeResultSchema = z.object({
	sha: z.string().min(1).optional(),
	merged: z.boolean(),
})

const MERGE_METHODS: Record<
	Exclude<MergeStrategy, 'fast_forward'>,
	'merge' | 'squash' | 'rebase'
> = {
	merge_commit: 'merge',
	squash: 'squash',
	rebase: 'rebase',
}

export interface GitHubUserWriteTarget {
	accessToken: string
	owner: string
	repo: string
}

interface PullRequestTarget extends GitHubUserWriteTarget {
	pullRequestNumber: number
}

interface CommentTarget extends GitHubUserWriteTarget {
	commentNumericId: bigint
}

interface CreateIssueCommentParams extends PullRequestTarget {
	body: string
}

interface CreateReviewCommentParams extends PullRequestTarget {
	anchor: PullRequestThreadAnchor
	body: string
	headSha: string
}

interface ReplyReviewCommentParams extends PullRequestTarget {
	body: string
	rootCommentNumericId: bigint
}

interface UpdateCommentParams extends CommentTarget {
	body: string
}

interface ReviewThreadTarget extends GitHubUserWriteTarget {
	threadNodeId: string
}

interface ReviewerParams extends PullRequestTarget {
	reviewerLogin: string
}

/** One batched draft, already mapped onto the coordinates GitHub places it by. */
export interface GitHubReviewCommentInput {
	anchor: PullRequestThreadAnchor
	body: string
}

interface CreateReviewParams extends PullRequestTarget {
	body: string
	comments?: readonly GitHubReviewCommentInput[]
	expectedHeadSha: string
	outcome: GitHubSyncReviewOutcome
}

interface ReviewTarget extends PullRequestTarget {
	reviewNumericId: bigint
}

interface ListReviewsParams extends PullRequestTarget {
	reviewerLogin: string
	/** Only reviews at least this recent can be the one the lost attempt created. */
	since: Date
}

interface UpdatePullRequestParams extends PullRequestTarget {
	body?: string
	state?: 'open' | 'closed'
	targetBranch?: string
	title?: string
}

interface MergePullRequestParams extends PullRequestTarget {
	expectedHeadSha: string
	strategy: Exclude<MergeStrategy, 'fast_forward'>
}

/** Kept apart from `GitHubSyncClient` so user failures never touch mirror health. */
@Injectable()
export class GitHubUserWriteClient {
	async createIssueComment({
		accessToken,
		body,
		owner,
		pullRequestNumber,
		repo,
	}: CreateIssueCommentParams): Promise<GitHubSyncIssueComment> {
		const response = await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.issues.createComment({
					owner,
					repo,
					issue_number: pullRequestNumber,
					body,
				})
		)

		return this.requireIssueComment(response.data)
	}

	async createReviewComment({
		accessToken,
		anchor,
		body,
		headSha,
		owner,
		pullRequestNumber,
		repo,
	}: CreateReviewCommentParams): Promise<GitHubSyncReviewComment> {
		const response = await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.pulls.createReviewComment({
					owner,
					repo,
					pull_number: pullRequestNumber,
					commit_id: headSha,
					...toGitHubReviewCommentPayload({ anchor, body }),
				})
		)

		return this.requireReviewComment(response.data)
	}

	async createReplyForReviewComment({
		accessToken,
		body,
		owner,
		pullRequestNumber,
		repo,
		rootCommentNumericId,
	}: ReplyReviewCommentParams): Promise<GitHubSyncReviewComment> {
		const response = await this.request(
			'comment',
			async () =>
				await this.createForUser(
					accessToken
				).rest.pulls.createReplyForReviewComment({
					owner,
					repo,
					pull_number: pullRequestNumber,
					comment_id: Number(rootCommentNumericId),
					body,
				})
		)

		return this.requireReviewComment(response.data)
	}

	async updateIssueComment({
		accessToken,
		body,
		commentNumericId,
		owner,
		repo,
	}: UpdateCommentParams): Promise<GitHubSyncIssueComment> {
		const response = await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.issues.updateComment({
					owner,
					repo,
					comment_id: Number(commentNumericId),
					body,
				})
		)

		return this.requireIssueComment(response.data)
	}

	async updateReviewComment({
		accessToken,
		body,
		commentNumericId,
		owner,
		repo,
	}: UpdateCommentParams): Promise<GitHubSyncReviewComment> {
		const response = await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.pulls.updateReviewComment({
					owner,
					repo,
					comment_id: Number(commentNumericId),
					body,
				})
		)

		return this.requireReviewComment(response.data)
	}

	async deleteIssueComment({
		accessToken,
		commentNumericId,
		owner,
		repo,
	}: CommentTarget): Promise<void> {
		await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.issues.deleteComment({
					owner,
					repo,
					comment_id: Number(commentNumericId),
				})
		)
	}

	async deleteReviewComment({
		accessToken,
		commentNumericId,
		owner,
		repo,
	}: CommentTarget): Promise<void> {
		await this.request(
			'comment',
			async () =>
				await this.createForUser(accessToken).rest.pulls.deleteReviewComment({
					owner,
					repo,
					comment_id: Number(commentNumericId),
				})
		)
	}

	async resolveReviewThread({
		accessToken,
		threadNodeId,
	}: ReviewThreadTarget): Promise<void> {
		await this.request(
			'thread',
			async () =>
				await this.createForUser(accessToken).graphql(
					RESOLVE_REVIEW_THREAD_MUTATION,
					{ threadId: threadNodeId }
				)
		)
	}

	async unresolveReviewThread({
		accessToken,
		threadNodeId,
	}: ReviewThreadTarget): Promise<void> {
		await this.request(
			'thread',
			async () =>
				await this.createForUser(accessToken).graphql(
					UNRESOLVE_REVIEW_THREAD_MUTATION,
					{ threadId: threadNodeId }
				)
		)
	}

	async requestReviewer({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
		reviewerLogin,
	}: ReviewerParams): Promise<void> {
		await this.request(
			'reviewers',
			async () =>
				await this.createForUser(accessToken).rest.pulls.requestReviewers({
					owner,
					repo,
					pull_number: pullRequestNumber,
					reviewers: [reviewerLogin],
				})
		)
	}

	async removeRequestedReviewer({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
		reviewerLogin,
	}: ReviewerParams): Promise<void> {
		await this.request(
			'reviewers',
			async () =>
				await this.createForUser(
					accessToken
				).rest.pulls.removeRequestedReviewers({
					owner,
					repo,
					pull_number: pullRequestNumber,
					reviewers: [reviewerLogin],
				})
		)
	}

	/**
	 * The whole batch in one call: GitHub validates every comment before it
	 * creates the review, so the array is all-or-nothing.
	 */
	async createReview({
		accessToken,
		body,
		comments,
		expectedHeadSha,
		outcome,
		owner,
		pullRequestNumber,
		repo,
	}: CreateReviewParams): Promise<
		GitHubSyncReview & { outcome: GitHubSyncReviewOutcome }
	> {
		const response = await this.request(
			'review',
			async () =>
				await this.createForUser(accessToken).rest.pulls.createReview({
					owner,
					repo,
					pull_number: pullRequestNumber,
					commit_id: expectedHeadSha,
					event: REVIEW_EVENTS[outcome],
					body,
					comments: comments?.map(toGitHubReviewCommentPayload),
				})
		)

		return this.requireSubmittedReview(response.data)
	}

	/** The review's own comments: `createReview` answers without them. */
	async listReviewComments({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
		reviewNumericId,
	}: ReviewTarget): Promise<GitHubSyncReviewComment[]> {
		const response = await this.request(
			'review',
			async () =>
				await this.createForUser(accessToken).rest.pulls.listCommentsForReview({
					owner,
					repo,
					pull_number: pullRequestNumber,
					review_id: Number(reviewNumericId),
					per_page: REVIEW_COMMENT_PAGE_SIZE,
				})
		)

		return response.data.flatMap(comment => {
			const mapped = toGitHubSyncReviewComment(
				gitHubReviewCommentSchema.parse(comment)
			)

			return mapped ? [mapped] : []
		})
	}

	/**
	 * The reviewer's own submissions from a moment on, which is how an attempt
	 * whose response was lost finds the review it may already have created.
	 */
	async listOwnReviewsSince({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
		reviewerLogin,
		since,
	}: ListReviewsParams): Promise<
		(GitHubSyncReview & { outcome: GitHubSyncReviewOutcome })[]
	> {
		const response = await this.request(
			'review',
			async () =>
				await this.createForUser(accessToken).rest.pulls.listReviews({
					owner,
					repo,
					pull_number: pullRequestNumber,
					per_page: REVIEW_COMMENT_PAGE_SIZE,
				})
		)

		return response.data.flatMap(data => {
			if (data.user?.login !== reviewerLogin) return []

			const review = toGitHubSyncReview(gitHubReviewSchema.parse(data))

			if (!review?.outcome) return []
			if (review.submittedAt.getTime() < since.getTime()) return []

			return [{ ...review, outcome: review.outcome }]
		})
	}

	async updatePullRequest({
		accessToken,
		body,
		owner,
		pullRequestNumber,
		repo,
		state,
		targetBranch,
		title,
	}: UpdatePullRequestParams): Promise<GitHubSyncPullRequest> {
		const response = await this.request(
			'pull_request',
			async () =>
				await this.createForUser(accessToken).rest.pulls.update({
					owner,
					repo,
					pull_number: pullRequestNumber,
					title,
					body,
					base: targetBranch,
					state,
				})
		)

		return toGitHubSyncPullRequest(gitHubPullRequestSchema.parse(response.data))
	}

	/** The expected head travels as `sha`, so GitHub refuses a moved pull request. */
	async mergePullRequest({
		accessToken,
		expectedHeadSha,
		owner,
		pullRequestNumber,
		repo,
		strategy,
	}: MergePullRequestParams): Promise<string> {
		try {
			const response = await this.request(
				'merge',
				async () =>
					await this.createForUser(accessToken).rest.pulls.merge({
						owner,
						repo,
						pull_number: pullRequestNumber,
						sha: expectedHeadSha,
						merge_method: MERGE_METHODS[strategy],
					})
			)
			const result = gitHubMergeResultSchema.parse(response.data)

			// GitHub answers 200 with `merged: false` when it declined the merge.
			if (!(result.merged && result.sha))
				throw new GitHubWriteRejectedError('unmergeable', { action: 'merge' })

			return result.sha
		} catch (error) {
			// A rebase refusal has its own explanation: the branch does not replay,
			// and switching strategy is the fix worth naming.
			if (
				strategy === 'rebase' &&
				error instanceof GitHubWriteRejectedError &&
				error.reason === 'unmergeable'
			)
				throw new GitHubWriteRejectedError('rebase_unmergeable', {
					action: 'merge',
				})

			throw error
		}
	}

	async getPullRequest({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
	}: PullRequestTarget): Promise<GitHubSyncPullRequest> {
		const response = await this.request(
			'pull_request',
			async () =>
				await this.createForUser(accessToken).rest.pulls.get({
					owner,
					repo,
					pull_number: pullRequestNumber,
				})
		)

		return toGitHubSyncPullRequest(gitHubPullRequestSchema.parse(response.data))
	}

	private createForUser(accessToken: string) {
		return new Octokit({ auth: accessToken })
	}

	private async request<T>(
		action: GitHubWriteAction,
		run: () => Promise<T>
	): Promise<T> {
		try {
			return await run()
		} catch (error) {
			throw toGitHubWriteError(error, action)
		}
	}

	private requireIssueComment(data: unknown): GitHubSyncIssueComment {
		const comment = toGitHubSyncIssueComment(
			gitHubIssueCommentSchema.parse(data)
		)

		if (!comment) throw new GitHubResponseUnreadableError({ action: 'comment' })

		return comment
	}

	private requireSubmittedReview(
		data: unknown
	): GitHubSyncReview & { outcome: GitHubSyncReviewOutcome } {
		const review = toGitHubSyncReview(gitHubReviewSchema.parse(data))

		if (!review?.outcome)
			throw new GitHubResponseUnreadableError({ action: 'review' })

		return { ...review, outcome: review.outcome }
	}

	private requireReviewComment(data: unknown): GitHubSyncReviewComment {
		const comment = toGitHubSyncReviewComment(
			gitHubReviewCommentSchema.parse(data)
		)

		if (!comment) throw new GitHubResponseUnreadableError({ action: 'comment' })

		return comment
	}
}

/** GitHub reads a start line as a second anchor, so a single line must omit it. */
function toGitHubReviewCommentPayload({
	anchor,
	body,
}: GitHubReviewCommentInput) {
	const side = anchor.side === 'left' ? ('LEFT' as const) : ('RIGHT' as const)

	return {
		path: anchor.path,
		body,
		side,
		line: anchor.endLine,
		...(anchor.startLine < anchor.endLine
			? ({ start_line: anchor.startLine, start_side: side } as const)
			: {}),
	}
}
