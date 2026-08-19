import type {
	PullRequestChangedFile,
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadSide,
} from '@repo/contracts'

type PullRequestDiffLine = PullRequestFileDiff['hunks'][number]['lines'][number]

/** Matches the contract bound on a thread anchor's line excerpt. */
const LINE_EXCERPT_MAX_LENGTH = 4096

/**
 * Trims a diff line down to what an anchor may carry. Minified sources produce
 * single lines far longer than the contract accepts.
 */
export function toThreadLineExcerpt(content: string) {
	return content.slice(0, LINE_EXCERPT_MAX_LENGTH)
}

/**
 * Threads a diff line renders, a range being discussed under its last line only.
 * Lines come from the current anchor, which the server re-locates as the diff
 * moves and withholds from a thread whose lines are gone.
 */
export function getInlineThreadsForLine(
	threads: PullRequestThread[],
	side: PullRequestThreadSide,
	line: number
) {
	return threads.filter(
		thread =>
			thread.currentAnchor?.side === side &&
			thread.currentAnchor.endLine === line
	)
}

export function isLineInsideInlineThread(
	threads: PullRequestThread[],
	side: PullRequestThreadSide,
	line: number
) {
	return threads.some(
		thread =>
			thread.currentAnchor?.side === side &&
			thread.currentAnchor.startLine <= line &&
			line <= thread.currentAnchor.endLine
	)
}

/**
 * Threads a file card owns. Renames keep threads anchored to the old path, so
 * the renamed file claims them — unless another changed file now occupies that
 * path, which takes precedence so no thread renders twice.
 */
export function getInlineThreadsForFile(
	threads: PullRequestThread[],
	file: PullRequestChangedFile,
	files: PullRequestChangedFile[]
) {
	return threads.filter(thread => {
		const path = thread.anchor?.path
		if (path === undefined) return false
		if (path === file.newPath) return true

		return (
			path === file.oldPath &&
			!files.some(changedFile => changedFile.newPath === path)
		)
	})
}

/**
 * Inline threads anchored to a superseded comparison, listed separately per file.
 */
export function getOutdatedInlineThreads(threads: PullRequestThread[]) {
	return threads.filter(thread => thread.kind === 'inline' && thread.outdated)
}

/**
 * Threads a file card cannot place on a rendered line: outdated ones, and
 * current ones whose anchor sits outside the displayed hunks (truncated diffs,
 * context boundaries). Both would silently disappear without a fallback list.
 */
export function getLeftoverInlineThreads(
	threads: PullRequestThread[],
	diff: PullRequestFileDiff,
	/** Context lines an expanded gap put on screen, which the hunks do not list. */
	revealedLines: readonly PullRequestDiffLine[] = []
) {
	const renderedLines = new Set(
		[...diff.hunks.flatMap(hunk => hunk.lines), ...revealedLines].flatMap(
			line => [
				...(line.old ? [`left:${line.old.line}`] : []),
				...(line.new ? [`right:${line.new.line}`] : []),
			]
		)
	)

	return threads.filter(thread => {
		if (thread.anchor === undefined) return false

		const anchor = thread.currentAnchor

		return (
			anchor === undefined ||
			!renderedLines.has(`${anchor.side}:${anchor.endLine}`)
		)
	})
}

/**
 * Inline threads no file card can show: their path left the comparison, or the
 * file it belongs to renders no diff at all. Without a home of their own they
 * would silently disappear from the review.
 */
export function getUnanchoredInlineThreads(
	threads: PullRequestThread[],
	files: PullRequestChangedFile[]
) {
	return threads.filter(thread => {
		if (thread.kind !== 'inline') return false

		const file = files.find(
			changedFile =>
				thread.anchor?.path === changedFile.newPath ||
				thread.anchor?.path === changedFile.oldPath
		)

		return !file || file.isBinary
	})
}
