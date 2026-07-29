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
