import { z } from 'zod'
import type {
	GitHubSyncActor,
	GitHubSyncActorType,
	GitHubSyncDiffSide,
	GitHubSyncIssueComment,
	GitHubSyncPullRequest,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewOutcome,
} from './github-sync.client.types'

export const gitHubActorSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	login: z.string().min(1),
	type: z.string().min(1),
	avatar_url: z.url().nullish(),
	html_url: z.url().nullish(),
})

export const gitHubDiffSideSchema = z.enum(['LEFT', 'RIGHT'])
const gitHubSubjectTypeSchema = z.enum(['line', 'file'])

export const gitHubPullRequestSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	number: z.number().int().positive(),
	html_url: z.url(),
	title: z.string(),
	body: z.string().nullish(),
	state: z.enum(['open', 'closed']),
	draft: z.boolean().nullish(),
	user: gitHubActorSchema,
	merged_at: z.string().nullish(),
	merged_by: gitHubActorSchema.nullish(),
	merge_commit_sha: z.string().nullish(),
	created_at: z.string(),
	updated_at: z.string(),
	closed_at: z.string().nullish(),
	head: z.object({
		ref: z.string().min(1),
		sha: z.string().min(1),
		repo: z.object({ node_id: z.string().min(1) }).nullish(),
	}),
	base: z.object({
		ref: z.string().min(1),
		sha: z.string().min(1),
		repo: z.object({ node_id: z.string().min(1) }),
	}),
})

export const gitHubIssueCommentSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	html_url: z.url(),
	body: z.string().nullish(),
	user: gitHubActorSchema.nullish(),
	created_at: z.string(),
	updated_at: z.string(),
})

export const gitHubReviewCommentSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	html_url: z.url(),
	body: z.string().nullish(),
	user: gitHubActorSchema.nullish(),
	pull_request_review_id: z.number().int().positive().nullish(),
	in_reply_to_id: z.number().int().positive().nullish(),
	subject_type: gitHubSubjectTypeSchema.nullish(),
	path: z.string().min(1),
	side: gitHubDiffSideSchema.nullish(),
	line: z.number().int().nullish(),
	original_line: z.number().int().nullish(),
	start_side: gitHubDiffSideSchema.nullish(),
	start_line: z.number().int().nullish(),
	original_start_line: z.number().int().nullish(),
	commit_id: z.string().min(1).nullish(),
	original_commit_id: z.string().min(1).nullish(),
	diff_hunk: z.string().nullish(),
	created_at: z.string(),
	updated_at: z.string(),
})

export const gitHubReviewSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	html_url: z.url(),
	body: z.string().nullish(),
	user: gitHubActorSchema.nullish(),
	state: z.string().min(1),
	commit_id: z.string().min(1).nullish(),
	submitted_at: z.string().nullish(),
})

export type GitHubRestPullRequest = z.infer<typeof gitHubPullRequestSchema>

export function toGitHubSyncPullRequest(
	pullRequest: GitHubRestPullRequest
): GitHubSyncPullRequest {
	const mergedAt = toOptionalDate(pullRequest.merged_at)

	return {
		nodeId: pullRequest.node_id,
		numericId: BigInt(pullRequest.id),
		number: pullRequest.number,
		htmlUrl: pullRequest.html_url,
		title: pullRequest.title,
		body: pullRequest.body ?? '',
		state: mergedAt ? 'merged' : pullRequest.state,
		draft: pullRequest.draft ?? false,
		author: toGitHubSyncActor(pullRequest.user),
		mergedBy: pullRequest.merged_by
			? toGitHubSyncActor(pullRequest.merged_by)
			: undefined,
		// Open pull requests carry GitHub's test-merge sha, which is not a merge.
		mergeCommitSha: mergedAt
			? (pullRequest.merge_commit_sha ?? undefined)
			: undefined,
		sourceBranch: pullRequest.head.ref,
		targetBranch: pullRequest.base.ref,
		headRepositoryNodeId: pullRequest.head.repo?.node_id,
		baseRepositoryNodeId: pullRequest.base.repo.node_id,
		headSha: pullRequest.head.sha,
		baseSha: pullRequest.base.sha,
		createdAt: new Date(pullRequest.created_at),
		updatedAt: new Date(pullRequest.updated_at),
		closedAt: toOptionalDate(pullRequest.closed_at),
		mergedAt,
	}
}

/** Absent when GitHub attributed the comment to a user it no longer exposes. */
export function toGitHubSyncIssueComment(
	comment: z.infer<typeof gitHubIssueCommentSchema>
): GitHubSyncIssueComment | undefined {
	if (!comment.user) return undefined

	return {
		nodeId: comment.node_id,
		numericId: BigInt(comment.id),
		author: toGitHubSyncActor(comment.user),
		body: comment.body ?? '',
		htmlUrl: comment.html_url,
		createdAt: new Date(comment.created_at),
		updatedAt: new Date(comment.updated_at),
	}
}

export function toGitHubSyncReviewComment(
	comment: z.infer<typeof gitHubReviewCommentSchema>
): GitHubSyncReviewComment | undefined {
	if (!comment.user) return undefined

	return {
		nodeId: comment.node_id,
		numericId: BigInt(comment.id),
		author: toGitHubSyncActor(comment.user),
		body: comment.body ?? '',
		htmlUrl: comment.html_url,
		reviewNumericId: toOptionalBigInt(comment.pull_request_review_id),
		inReplyToNumericId: toOptionalBigInt(comment.in_reply_to_id),
		subjectType: comment.subject_type ?? 'line',
		path: comment.path,
		side: toGitHubSyncDiffSide(comment.side),
		line: comment.line ?? undefined,
		originalLine: comment.original_line ?? undefined,
		startSide: toGitHubSyncDiffSide(comment.start_side),
		startLine: comment.start_line ?? undefined,
		originalStartLine: comment.original_start_line ?? undefined,
		commitId: comment.commit_id ?? undefined,
		originalCommitId: comment.original_commit_id ?? undefined,
		diffHunk: comment.diff_hunk ?? undefined,
		createdAt: new Date(comment.created_at),
		updatedAt: new Date(comment.updated_at),
	}
}

/** Absent for a review GitHub still holds as a draft, which has no history yet. */
export function toGitHubSyncReview(
	review: z.infer<typeof gitHubReviewSchema>
): GitHubSyncReview | undefined {
	const state = review.state.toLowerCase()

	if (!(review.user && review.submitted_at) || state === 'pending')
		return undefined

	return {
		nodeId: review.node_id,
		numericId: BigInt(review.id),
		reviewer: toGitHubSyncActor(review.user),
		body: review.body ?? '',
		outcome: toGitHubSyncReviewOutcome(state),
		dismissed: state === 'dismissed',
		htmlUrl: review.html_url,
		commitId: review.commit_id ?? undefined,
		submittedAt: new Date(review.submitted_at),
	}
}

export function toGitHubSyncActor(
	actor: z.infer<typeof gitHubActorSchema>
): GitHubSyncActor {
	return {
		nodeId: actor.node_id,
		numericId: BigInt(actor.id),
		login: actor.login,
		type: toGitHubSyncActorType(actor.type),
		avatarUrl: actor.avatar_url ?? undefined,
		htmlUrl: actor.html_url ?? undefined,
	}
}

export function toGitHubSyncActorType(type: string): GitHubSyncActorType {
	switch (type.toLowerCase()) {
		case 'bot':
			return 'bot'
		case 'organization':
			return 'organization'
		case 'mannequin':
			return 'mannequin'
		default:
			return 'user'
	}
}

export function toGitHubSyncDiffSide(
	side: 'LEFT' | 'RIGHT' | null | undefined
): GitHubSyncDiffSide | undefined {
	if (!side) return undefined

	return side === 'LEFT' ? 'left' : 'right'
}

export function toGitHubSyncReviewOutcome(
	state: string
): GitHubSyncReviewOutcome | undefined {
	switch (state) {
		case 'approved':
			return 'approve'
		case 'changes_requested':
			return 'request_changes'
		case 'commented':
			return 'comment'
		default:
			return undefined
	}
}

function toOptionalBigInt(
	value: number | null | undefined
): bigint | undefined {
	return value ? BigInt(value) : undefined
}

export function toOptionalDate(
	value: string | null | undefined
): Date | undefined {
	return value ? new Date(value) : undefined
}
