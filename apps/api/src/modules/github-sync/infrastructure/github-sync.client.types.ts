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
	/** GitHub's own diff totals, absent when the stats query could not be read. */
	additions?: number
	deletions?: number
	changedFiles?: number
}

/**
 * What GitHub reported about the budget this installation has left, when the
 * response carried it. Reconciliation records it so a limit is visible before
 * a request is refused rather than only after.
 */
export interface GitHubSyncRateLimit {
	remaining?: number
	resetAt?: Date
}

export interface GitHubRepositoryReconciliation {
	repository: GitHubSyncRepository
	pullRequests: GitHubSyncPullRequest[]
	pullRequestCursorAt: Date
	rateLimit?: GitHubSyncRateLimit
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

/**
 * The GitHub App that reported a check. An app is not a person and never
 * becomes an actor, so its identity travels as a snapshot.
 */
export interface GitHubSyncCheckApp {
	nodeId: string
	numericId: bigint
	slug?: string
	name?: string
	htmlUrl?: string
}

/**
 * Provider status and conclusion stay as GitHub wrote them. Normalizing to a
 * native state is the projection's job, and the raw pair has to survive for a
 * value Tessera does not recognize yet to remain readable.
 */
export interface GitHubSyncCheckSuite {
	nodeId: string
	numericId: bigint
	headSha: string
	status?: string
	conclusion?: string
	app?: GitHubSyncCheckApp
	createdAt?: Date
	updatedAt?: Date
}

export interface GitHubSyncCheckRun {
	nodeId: string
	numericId: bigint
	suiteNodeId?: string
	suiteNumericId?: bigint
	name: string
	headSha: string
	status?: string
	conclusion?: string
	/** The provider's own correlation key, opaque to Tessera. */
	externalId?: string
	detailsUrl?: string
	htmlUrl?: string
	outputTitle?: string
	outputSummary?: string
	app?: GitHubSyncCheckApp
	startedAt?: Date
	completedAt?: Date
}

export interface GitHubSyncCommitStatus {
	nodeId: string
	numericId: bigint
	context: string
	state: string
	targetUrl?: string
	description?: string
	creator?: GitHubSyncActor
	createdAt: Date
	updatedAt: Date
}

/**
 * Which request in a checks snapshot failed. `ref` is a listing addressed by the
 * commit itself, so a 404 there is the commit being gone; `suite` is a child
 * resource GitHub may prune under a snapshot that is otherwise fine.
 */
export type GitHubChecksRequestScope = 'ref' | 'suite'

/**
 * Everything GitHub reports for one commit, listed exhaustively rather than
 * combined: a rollup would drop the history the append-only ledger is for.
 */
export interface GitHubChecksSnapshot {
	sha: string
	suites: GitHubSyncCheckSuite[]
	runs: GitHubSyncCheckRun[]
	statuses: GitHubSyncCommitStatus[]
	rateLimit?: GitHubSyncRateLimit
}

export interface GitHubPullRequestConversation {
	issueComments: GitHubSyncIssueComment[]
	reviewComments: GitHubSyncReviewComment[]
	reviews: GitHubSyncReview[]
	requestedReviewers: GitHubSyncReviewerRequestTarget[]
	reviewThreads: GitHubSyncReviewThread[]
	rateLimit?: GitHubSyncRateLimit
}
