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

const gitHubMergeResultSchema = z.object({
	sha: z.string().min(1),
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

interface CreateReviewParams extends PullRequestTarget {
	body: string
	outcome: GitHubSyncReviewOutcome
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
					body,
					commit_id: anchor.headSha,
					path: anchor.path,
					side: anchor.side === 'left' ? 'LEFT' : 'RIGHT',
					line: anchor.line,
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

	async createReview({
		accessToken,
		body,
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
					event: REVIEW_EVENTS[outcome],
					body,
				})
		)
		const review = toGitHubSyncReview(gitHubReviewSchema.parse(response.data))

		if (!review?.outcome)
			throw new GitHubResponseUnreadableError({ action: 'review' })

		return { ...review, outcome: review.outcome }
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
		if (!result.merged)
			throw new GitHubWriteRejectedError('unmergeable', { action: 'merge' })

		return result.sha
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

	private requireReviewComment(data: unknown): GitHubSyncReviewComment {
		const comment = toGitHubSyncReviewComment(
			gitHubReviewCommentSchema.parse(data)
		)

		if (!comment) throw new GitHubResponseUnreadableError({ action: 'comment' })

		return comment
	}
}
