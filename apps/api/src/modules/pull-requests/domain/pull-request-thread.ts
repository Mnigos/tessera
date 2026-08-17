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
import {
	requirePullRequestActorOutput,
	toPullRequestActorOutput,
} from './pull-request-actor'

export interface PullRequestThreadComparison {
	baseSha: string
	headSha: string
}

export function toPullRequestCommentOutput(
	comment: PullRequestCommentReadModel
): PullRequestCommentOutput {
	return {
		id: comment.id,
		threadId: comment.threadId,
		author: requirePullRequestActorOutput(
			comment.author,
			'pull request comment author'
		),
		body: comment.body,
		state: comment.state,
		createdAt: comment.createdAt,
		editedAt: comment.editedAt ?? undefined,
		sourceUrl: comment.sourceUrl ?? undefined,
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

/**
 * GitHub decides outdatedness for the threads it owns — it can see history a
 * mirrored comparison cannot — so its verdict stands on its own, and the local
 * base/head comparison still catches anchors that aged after the last sync.
 */
export function isPullRequestThreadOutdated(
	thread: PullRequestThreadReadModel,
	comparison: PullRequestThreadComparison
): boolean {
	if (thread.kind !== 'inline') return false
	if (thread.providerOutdated) return true

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

	return {
		anchorSha,
		baseSha,
		endLine: line,
		headSha,
		lineExcerpt,
		path,
		side,
		startLine: thread.startLine ?? line,
	}
}

/**
 * A resolution needs somebody to attribute it to. A synchronized thread whose
 * resolver GitHub never reported reads as unresolved rather than failing the
 * whole page, and the next reconciliation repairs it.
 */
function toPullRequestThreadResolution(thread: PullRequestThreadReadModel) {
	if (!thread.resolvedAt) return undefined

	const by = toPullRequestActorOutput(thread.resolvedBy)

	return by ? { at: thread.resolvedAt, by } : undefined
}
