import type {
	GitHubSyncDiffSide,
	GitHubSyncReviewComment,
} from '../infrastructure/github-sync.client.types'

const LINE_EXCERPT_MAX_LENGTH = 4096
const DIFF_HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export interface GitHubPullRequestAnchorCoordinates {
	path: string
	side: GitHubSyncDiffSide
	line: number
	/** Absent unless the comment spans more than the one line it ends on. */
	startLine?: number
	lineExcerpt: string
	/** Head of the comparison these coordinates are numbered against. */
	headSha: string
	/** The comment hangs where GitHub last placed it, not where it is now. */
	outdated: boolean
}

export interface GitHubPullRequestAnchorInput {
	currentHeadSha: string
	/** Absent when GraphQL never reported the thread: unknown, not current. */
	providerOutdated?: boolean
}

/**
 * Line, head, and excerpt are one coordinate set: a line taken from the current
 * diff pinned to a historical head describes a comparison that never existed.
 * Where GitHub still places the comment is preferred, where it last placed it is
 * the fallback, and a comment neither set can number stays a mapping-only record
 * rather than hanging on an invented line.
 */
export function toGitHubPullRequestAnchorCoordinates(
	comment: GitHubSyncReviewComment,
	{ currentHeadSha, providerOutdated }: GitHubPullRequestAnchorInput
): GitHubPullRequestAnchorCoordinates | undefined {
	if (comment.subjectType !== 'line') return undefined

	const side = comment.side ?? 'right'
	// A range GitHub starts on the other side is two anchors, and this model holds one.
	const startsOnSide = (comment.startSide ?? side) === side
	const candidates = [
		providerOutdated
			? undefined
			: toAnchorCandidate(false, {
					line: comment.line,
					startLine: startsOnSide ? comment.startLine : undefined,
					headSha: currentHeadSha,
				}),
		toAnchorCandidate(true, {
			line: comment.originalLine,
			startLine: startsOnSide ? comment.originalStartLine : undefined,
			headSha: comment.originalCommitId ?? comment.commitId,
		}),
	]

	for (const candidate of candidates) {
		if (!candidate) continue

		const lineExcerpt = toGitHubDiffHunkExcerpt(
			comment.diffHunk,
			side,
			candidate.line
		)

		if (lineExcerpt === undefined) continue

		return { path: comment.path, side, lineExcerpt, ...candidate }
	}

	return undefined
}

function toAnchorCandidate(
	outdated: boolean,
	placement: { line?: number; startLine?: number; headSha?: string }
):
	| { line: number; startLine?: number; headSha: string; outdated: boolean }
	| undefined {
	const { headSha, line, startLine } = placement

	if (!line || line <= 0 || !headSha) return undefined

	return {
		line,
		startLine:
			startLine && startLine > 0 && startLine < line ? startLine : undefined,
		headSha,
		outdated,
	}
}

/**
 * Walks the hunk the way Git numbers it so the excerpt is the line the comment
 * actually hangs on. A hunk that does not cover that line cannot describe it, so
 * the excerpt is absent and the anchor degrades rather than quoting a line the
 * comment was never written against.
 */
export function toGitHubDiffHunkExcerpt(
	diffHunk: string | undefined,
	side: GitHubSyncDiffSide,
	line: number
): string | undefined {
	if (!diffHunk) return undefined

	const cursor: DiffHunkCursor = { newLine: 0, oldLine: 0 }

	for (const hunkLine of diffHunk.split('\n')) {
		const content = readDiffHunkLine(hunkLine, cursor, side)

		if (content?.line === line) return capExcerpt(content.text)
	}

	return undefined
}

interface DiffHunkCursor {
	newLine: number
	oldLine: number
}

interface DiffHunkContent {
	/** Absent when the line does not exist on the requested side. */
	line?: number
	text: string
}

/** Advances the cursor and numbers the line the way the given side counts. */
function readDiffHunkLine(
	hunkLine: string,
	cursor: DiffHunkCursor,
	side: GitHubSyncDiffSide
): DiffHunkContent | undefined {
	const header = DIFF_HUNK_HEADER_PATTERN.exec(hunkLine)

	if (header) {
		cursor.oldLine = Number(header[1])
		cursor.newLine = Number(header[2])
		return undefined
	}

	if (hunkLine.length === 0 || hunkLine.startsWith('\\')) return undefined

	const text = hunkLine.slice(1)

	if (hunkLine.startsWith('+')) {
		const line = cursor.newLine
		cursor.newLine += 1

		return { line: side === 'right' ? line : undefined, text }
	}

	if (hunkLine.startsWith('-')) {
		const line = cursor.oldLine
		cursor.oldLine += 1

		return { line: side === 'left' ? line : undefined, text }
	}

	const line = side === 'right' ? cursor.newLine : cursor.oldLine
	cursor.oldLine += 1
	cursor.newLine += 1

	return { line, text }
}

function capExcerpt(content: string): string {
	return content.slice(0, LINE_EXCERPT_MAX_LENGTH)
}
