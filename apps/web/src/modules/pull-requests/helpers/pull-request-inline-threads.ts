import type {
	PullRequestChangedFile,
	PullRequestThread,
	PullRequestThreadSide,
} from '@repo/contracts'

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
 * Threads anchored to a diff line of the current comparison. Outdated threads
 * are excluded because their line may no longer exist in the rendered diff.
 */
export function getInlineThreadsForLine(
	threads: PullRequestThread[],
	side: PullRequestThreadSide,
	line: number
) {
	return threads.filter(
		thread =>
			!thread.outdated &&
			thread.anchor?.side === side &&
			thread.anchor.line === line
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
