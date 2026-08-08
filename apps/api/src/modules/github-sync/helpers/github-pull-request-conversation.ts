import type {
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncCommentSubjectType,
	GitHubSyncReviewComment,
} from '../infrastructure/github-sync.client.types'

export interface GitHubGroupedReviewThread {
	/** GraphQL thread node id, absent when the thread fell outside its page. */
	externalNodeId?: string
	rootCommentNodeId: string
	root: GitHubSyncReviewComment
	comments: GitHubSyncReviewComment[]
	/**
	 * Absent when GraphQL did not return the thread. Resolution is unknown then,
	 * never unresolved: GraphQL is the only source for it, so assuming the
	 * default would clear a resolution nobody touched.
	 */
	resolved?: boolean
	resolvedBy?: GitHubSyncActor
	/** Absent for the same reason as `resolved`. */
	providerOutdated?: boolean
	subjectType: GitHubSyncCommentSubjectType
}

export interface GitHubGroupedConversation {
	threads: GitHubGroupedReviewThread[]
	/** Replies whose root this snapshot does not contain; repaired next pass. */
	orphanedComments: GitHubSyncReviewComment[]
}

/**
 * GraphQL owns thread membership; REST owns comment content and the reply
 * chain. Grouping merges the two so a thread longer than one GraphQL page, or
 * one GraphQL never returned, still collapses onto the same root.
 */
export function groupGitHubReviewThreads({
	reviewComments,
	reviewThreads,
}: Pick<
	GitHubPullRequestConversation,
	'reviewComments' | 'reviewThreads'
>): GitHubGroupedConversation {
	const commentsByNumericId = new Map(
		reviewComments.map(comment => [comment.numericId, comment])
	)
	const threadNodeIdByCommentNodeId = new Map<string, string>()

	for (const thread of reviewThreads)
		for (const comment of thread.comments)
			threadNodeIdByCommentNodeId.set(comment.nodeId, thread.nodeId)

	const threadsByNodeId = new Map(
		reviewThreads.map(thread => [thread.nodeId, thread])
	)
	const groups = new Map<string, GitHubGroupedReviewThread>()
	const orphanedComments: GitHubSyncReviewComment[] = []

	for (const comment of [...reviewComments].sort(byCreatedAt)) {
		// A root GitHub deleted leaves its replies pointing at nothing. The
		// GraphQL thread they still belong to re-roots them on the oldest
		// survivor; without one there is nothing to attach them to yet.
		const resolvedRoot = findRootComment(comment, commentsByNumericId)
		const root = resolvedRoot ?? comment
		const externalNodeId = threadNodeIdByCommentNodeId.get(root.nodeId)

		if (!(resolvedRoot || externalNodeId)) {
			orphanedComments.push(comment)
			continue
		}

		const groupKey = externalNodeId ?? root.nodeId
		const group = groups.get(groupKey)

		if (group) {
			group.comments.push(comment)
			continue
		}

		const thread = externalNodeId
			? threadsByNodeId.get(externalNodeId)
			: undefined

		groups.set(groupKey, {
			externalNodeId,
			rootCommentNodeId: root.nodeId,
			root,
			comments: [comment],
			resolved: thread?.resolved,
			resolvedBy: thread?.resolvedBy,
			providerOutdated: thread?.outdated,
			subjectType: thread?.subjectType ?? root.subjectType,
		})
	}

	return { threads: [...groups.values()], orphanedComments }
}

/**
 * A reply points at its parent by numeric id; GitHub only nests one level, but
 * the walk is guarded so a cycle cannot hang the projection.
 */
function findRootComment(
	comment: GitHubSyncReviewComment,
	commentsByNumericId: Map<bigint, GitHubSyncReviewComment>
): GitHubSyncReviewComment | undefined {
	const visited = new Set<bigint>([comment.numericId])
	let current = comment

	while (current.inReplyToNumericId !== undefined) {
		if (visited.has(current.inReplyToNumericId)) return current

		const parent = commentsByNumericId.get(current.inReplyToNumericId)
		if (!parent) return undefined

		visited.add(parent.numericId)
		current = parent
	}

	return current
}

function byCreatedAt(
	left: GitHubSyncReviewComment,
	right: GitHubSyncReviewComment
): number {
	return left.createdAt.getTime() - right.createdAt.getTime()
}
