import type {
	PullRequestComment as PullRequestCommentOutput,
	PullRequestThreadAnchor,
	PullRequestThread as PullRequestThreadOutput,
	PullRequestThreadPlacement,
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

/** The shape of a changed file the anchoring rules read, as git storage reports it. */
export interface PullRequestThreadComparisonFile {
	baseBlobId?: string
	headBlobId?: string
	isBinary: boolean
	newPath: string
	oldPath: string
}

export interface PullRequestThreadDiffLine {
	content: string
	newLine?: number
	oldLine?: number
}

export type PullRequestThreadAnchorClassification =
	| { kind: 'current'; placement: PullRequestThreadPlacement }
	| { kind: 'outdated' }
	| { kind: 'relocate'; path: string }

/** Matches the contract bound on a thread anchor's line excerpt. */
const LINE_EXCERPT_MAX_LENGTH = 4096

export function toPullRequestCommentOutput(
	comment: PullRequestCommentReadModel
): PullRequestCommentOutput {
	return {
		id: comment.id,
		threadId: comment.threadId,
		reviewId: comment.reviewId ?? undefined,
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

/** An inline thread with nowhere to sit in the served comparison is what outdated means. */
export function toPullRequestThreadOutput(
	thread: PullRequestThreadReadModel,
	currentAnchor?: PullRequestThreadPlacement
): PullRequestThreadOutput {
	return {
		id: thread.id,
		kind: thread.kind,
		anchor: toPullRequestThreadAnchor(thread),
		currentAnchor,
		resolved: toPullRequestThreadResolution(thread),
		outdated: thread.kind === 'inline' && !currentAnchor,
		createdAt: thread.createdAt,
		comments: thread.comments.map(toPullRequestCommentOutput),
	}
}

/**
 * Places an inline thread in the comparison being served, without reading git:
 * the anchored side holding the same blob means the same lines at the same
 * numbers, and anything else has to be looked for in the current diff.
 *
 * GitHub decides outdatedness for the threads it owns, so its verdict stands on
 * its own, and a mirror — which reports no files here — answers by shas alone.
 */
export function classifyPullRequestThreadAnchor(
	thread: PullRequestThreadReadModel,
	comparison: PullRequestThreadComparison,
	files: PullRequestThreadComparisonFile[] | undefined
): PullRequestThreadAnchorClassification {
	if (thread.kind !== 'inline') return { kind: 'outdated' }
	if (thread.providerOutdated) return { kind: 'outdated' }

	const anchor = toPullRequestThreadAnchor(thread)

	if (!anchor) return { kind: 'outdated' }

	const placement = {
		path: anchor.path,
		side: anchor.side,
		startLine: anchor.startLine,
		endLine: anchor.endLine,
	}

	if (
		thread.baseSha === comparison.baseSha &&
		thread.headSha === comparison.headSha
	)
		return { kind: 'current', placement }

	if (!files) return { kind: 'outdated' }

	const file = files.find(
		changedFile =>
			changedFile.newPath === anchor.path || changedFile.oldPath === anchor.path
	)

	if (!file || file.isBinary) return { kind: 'outdated' }

	const anchoredBlobId =
		anchor.side === 'left' ? thread.baseBlobId : thread.headBlobId
	const currentBlobId =
		anchor.side === 'left' ? file.baseBlobId : file.headBlobId

	if (anchoredBlobId && anchoredBlobId === currentBlobId)
		return { kind: 'current', placement: { ...placement, path: file.newPath } }

	return { kind: 'relocate', path: file.newPath }
}

/** Finds the anchored line again by its own text, nearest match first so a duplicated line cannot drag the thread across the file. */
export function relocatePullRequestThreadAnchor(
	thread: PullRequestThreadReadModel,
	lines: PullRequestThreadDiffLine[],
	path: string
): PullRequestThreadPlacement | undefined {
	const anchor = toPullRequestThreadAnchor(thread)

	if (!anchor) return undefined

	let endLine: number | undefined

	for (const line of lines) {
		const lineNumber = anchor.side === 'left' ? line.oldLine : line.newLine

		if (
			lineNumber === undefined ||
			line.content.slice(0, LINE_EXCERPT_MAX_LENGTH) !== anchor.lineExcerpt
		)
			continue

		if (
			endLine === undefined ||
			Math.abs(lineNumber - anchor.endLine) < Math.abs(endLine - anchor.endLine)
		)
			endLine = lineNumber
	}

	if (endLine === undefined) return undefined

	return {
		path,
		side: anchor.side,
		startLine: Math.max(1, endLine - (anchor.endLine - anchor.startLine)),
		endLine,
	}
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
