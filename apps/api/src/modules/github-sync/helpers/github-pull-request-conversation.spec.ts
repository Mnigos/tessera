import type {
	GitHubSyncReviewComment,
	GitHubSyncReviewThread,
} from '../infrastructure/github-sync.client.types'
import { groupGitHubReviewThreads } from './github-pull-request-conversation'

const AUTHOR = {
	nodeId: 'actor-node',
	numericId: 2n,
	login: 'marta',
	type: 'user' as const,
}

describe(groupGitHubReviewThreads.name, () => {
	test('carries the resolution GraphQL reported onto the thread', () => {
		const root = reviewComment('root', 1n)
		const { threads } = groupGitHubReviewThreads({
			reviewComments: [root],
			reviewThreads: [
				reviewThread('thread-node', ['root'], {
					resolved: true,
					outdated: true,
					resolvedBy: AUTHOR,
				}),
			],
		})

		expect(threads).toMatchObject([
			{
				externalNodeId: 'thread-node',
				rootCommentNodeId: 'root',
				resolved: true,
				providerOutdated: true,
				resolvedBy: AUTHOR,
			},
		])
	})

	test('leaves resolution unknown for a thread GraphQL did not return', () => {
		const { threads } = groupGitHubReviewThreads({
			reviewComments: [reviewComment('root', 1n)],
			reviewThreads: [],
		})

		expect(threads).toHaveLength(1)
		expect(threads[0]?.resolved).toBeUndefined()
		expect(threads[0]?.providerOutdated).toBeUndefined()
	})

	test('groups a reply onto the root it answers', () => {
		const { orphanedComments, threads } = groupGitHubReviewThreads({
			reviewComments: [
				reviewComment('root', 1n),
				reviewComment('reply', 2n, { inReplyToNumericId: 1n }),
			],
			reviewThreads: [reviewThread('thread-node', ['root', 'reply'])],
		})

		expect(orphanedComments).toHaveLength(0)
		expect(threads).toHaveLength(1)
		expect(threads[0]?.comments.map(comment => comment.nodeId)).toEqual([
			'root',
			'reply',
		])
	})

	test('holds back a reply whose root this snapshot is missing', () => {
		const { orphanedComments, threads } = groupGitHubReviewThreads({
			reviewComments: [reviewComment('reply', 2n, { inReplyToNumericId: 1n })],
			reviewThreads: [],
		})

		expect(threads).toHaveLength(0)
		expect(orphanedComments.map(comment => comment.nodeId)).toEqual(['reply'])
	})
})

function reviewComment(
	nodeId: string,
	numericId: bigint,
	overrides: Partial<GitHubSyncReviewComment> = {}
): GitHubSyncReviewComment {
	return {
		nodeId,
		numericId,
		author: AUTHOR,
		body: 'Comment',
		htmlUrl: `https://github.com/org/repo/pull/1#discussion_r${numericId}`,
		subjectType: 'line',
		path: 'src/index.ts',
		createdAt: new Date(`2026-08-08T10:0${numericId}:00Z`),
		updatedAt: new Date(`2026-08-08T10:0${numericId}:00Z`),
		...overrides,
	}
}

function reviewThread(
	nodeId: string,
	commentNodeIds: string[],
	overrides: Partial<GitHubSyncReviewThread> = {}
): GitHubSyncReviewThread {
	return {
		nodeId,
		resolved: false,
		outdated: false,
		subjectType: 'line',
		comments: commentNodeIds.map(commentNodeId => ({ nodeId: commentNodeId })),
		...overrides,
	}
}
