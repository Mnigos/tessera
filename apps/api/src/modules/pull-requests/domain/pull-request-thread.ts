import type {
	PullRequestComment as PullRequestCommentOutput,
	PullRequestThreadAnchor,
	PullRequestThread as PullRequestThreadOutput,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import type {
	PullRequestCommentReadModel,
	PullRequestThreadReadModel,
} from '../infrastructure/pull-request-threads.repository'

export interface PullRequestThreadComparison {
	baseSha: string
	headSha: string
}

export function toPullRequestCommentOutput(
	comment: PullRequestCommentReadModel
): PullRequestCommentOutput {
	if (!comment.authorUsername)
		throw new Error('pull request comment author username is unavailable')

	return {
		id: comment.id,
		threadId: comment.threadId,
		authorUserId: comment.authorUserId,
		authorUsername: comment.authorUsername,
		body: comment.body,
		createdAt: comment.createdAt,
		editedAt: comment.editedAt ?? undefined,
	}
}

export function toPullRequestThreadOutput(
	thread: PullRequestThreadReadModel,
	outdated: boolean
): PullRequestThreadOutput {
	return {
		id: thread.id,
		kind: thread.kind,
		anchor: toPullRequestThreadAnchor(thread),
		resolved: toPullRequestThreadResolution(thread),
		outdated,
		createdAt: thread.createdAt,
		comments: thread.comments.map(toPullRequestCommentOutput),
	}
}

export function isPullRequestThreadOutdated(
	thread: PullRequestThreadReadModel,
	comparison: PullRequestThreadComparison
): boolean {
	if (thread.kind !== 'inline') return false

	return (
		thread.baseSha !== comparison.baseSha ||
		thread.headSha !== comparison.headSha
	)
}

export function isPullRequestThreadParticipant(
	thread: PullRequestThreadReadModel,
	userId: UserId
): boolean {
	return thread.comments.some(comment => comment.authorUserId === userId)
}

function toPullRequestThreadAnchor(
	thread: PullRequestThreadReadModel
): PullRequestThreadAnchor | undefined {
	const { anchorSha, baseSha, headSha, line, lineExcerpt, path, side } = thread

	if (
		thread.kind !== 'inline' ||
		path === null ||
		side === null ||
		line === null ||
		anchorSha === null ||
		baseSha === null ||
		headSha === null ||
		lineExcerpt === null
	)
		return undefined

	return { anchorSha, baseSha, headSha, line, lineExcerpt, path, side }
}

function toPullRequestThreadResolution(thread: PullRequestThreadReadModel) {
	if (!(thread.resolvedAt && thread.resolvedByUserId)) return undefined

	if (!thread.resolvedByUsername)
		throw new Error('pull request thread resolver username is unavailable')

	return {
		at: thread.resolvedAt,
		byUserId: thread.resolvedByUserId,
		byUsername: thread.resolvedByUsername,
	}
}
