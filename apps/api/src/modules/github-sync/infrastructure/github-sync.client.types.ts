export type GitHubSyncActorType = 'user' | 'bot' | 'organization' | 'mannequin'

export interface GitHubSyncActor {
	nodeId: string
	numericId: bigint
	login: string
	type: GitHubSyncActorType
	avatarUrl?: string
	htmlUrl?: string
}

export interface GitHubSyncRepository {
	nodeId: string
	numericId: bigint
	ownerLogin: string
	name: string
	fullName: string
	htmlUrl: string
	cloneUrl: string
	defaultBranch: string
}

export interface GitHubSyncPullRequest {
	nodeId: string
	numericId: bigint
	number: number
	htmlUrl: string
	title: string
	body: string
	state: 'open' | 'closed' | 'merged'
	draft: boolean
	author: GitHubSyncActor
	mergedBy?: GitHubSyncActor
	mergeCommitSha?: string
	sourceBranch: string
	targetBranch: string
	headRepositoryNodeId?: string
	baseRepositoryNodeId: string
	headSha: string
	baseSha: string
	createdAt: Date
	updatedAt: Date
	closedAt?: Date
	mergedAt?: Date
}

export interface GitHubRepositoryReconciliation {
	repository: GitHubSyncRepository
	pullRequests: GitHubSyncPullRequest[]
	pullRequestCursorAt: Date
}

export type GitHubSyncDiffSide = 'left' | 'right'
export type GitHubSyncCommentSubjectType = 'line' | 'file'
export type GitHubSyncReviewOutcome = 'approve' | 'request_changes' | 'comment'

export interface GitHubSyncIssueComment {
	nodeId: string
	numericId: bigint
	author: GitHubSyncActor
	body: string
	htmlUrl: string
	createdAt: Date
	updatedAt: Date
}

export interface GitHubSyncReviewComment {
	nodeId: string
	numericId: bigint
	author: GitHubSyncActor
	body: string
	htmlUrl: string
	reviewNumericId?: bigint
	inReplyToNumericId?: bigint
	subjectType: GitHubSyncCommentSubjectType
	path: string
	side?: GitHubSyncDiffSide
	line?: number
	originalLine?: number
	startSide?: GitHubSyncDiffSide
	startLine?: number
	originalStartLine?: number
	commitId?: string
	originalCommitId?: string
	diffHunk?: string
	createdAt: Date
	updatedAt: Date
}

export interface GitHubSyncReview {
	nodeId: string
	numericId: bigint
	reviewer: GitHubSyncActor
	body: string
	/** Absent once GitHub reports the review as dismissed; it stops exposing the original outcome. */
	outcome?: GitHubSyncReviewOutcome
	dismissed: boolean
	htmlUrl: string
	commitId?: string
	submittedAt: Date
}

export interface GitHubSyncRequestedUser {
	kind: 'user'
	actor: GitHubSyncActor
}

export interface GitHubSyncRequestedTeam {
	kind: 'team'
	nodeId: string
	numericId: bigint
	slug: string
	name: string
	htmlUrl?: string
}

export type GitHubSyncReviewerRequestTarget =
	| GitHubSyncRequestedUser
	| GitHubSyncRequestedTeam

export interface GitHubSyncReviewThreadComment {
	nodeId: string
	replyToNodeId?: string
	originalCommitSha?: string
}

export interface GitHubSyncReviewThread {
	nodeId: string
	resolved: boolean
	resolvedBy?: GitHubSyncActor
	outdated: boolean
	subjectType: GitHubSyncCommentSubjectType
	path?: string
	line?: number
	side?: GitHubSyncDiffSide
	comments: GitHubSyncReviewThreadComment[]
}

export interface GitHubPullRequestConversation {
	issueComments: GitHubSyncIssueComment[]
	reviewComments: GitHubSyncReviewComment[]
	reviews: GitHubSyncReview[]
	requestedReviewers: GitHubSyncReviewerRequestTarget[]
	reviewThreads: GitHubSyncReviewThread[]
}
