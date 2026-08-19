import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryDiffLine,
	GitStorageRepositoryFileDiff,
} from '@config/git-storage'
import type {
	PullRequestFileDiff,
	PullRequestFileLines,
	PullRequestThreadSide,
} from '@repo/contracts'
import {
	type HighlightedSourceCode,
	highlightSourceCode,
	type SourceLineMark,
	toHighlightedLineHtml,
} from '~/shared/helpers/source-code-highlighting'
import { toWordDiffMarks } from './pull-request-word-diff'

type PullRequestDiffLine = PullRequestFileDiff['hunks'][number]['lines'][number]

interface HighlightPullRequestDiffParams {
	baseBlob: GitStorageRepositoryBlob | undefined
	diff: GitStorageRepositoryFileDiff
	headBlob: GitStorageRepositoryBlob | undefined
}

/**
 * Selects visible hunk lines from complete-file highlighting while preserving stable source coordinates.
 */
export async function highlightPullRequestDiff({
	baseBlob,
	diff,
	headBlob,
}: HighlightPullRequestDiffParams): Promise<PullRequestFileDiff> {
	const [baseHighlight, headHighlight] = await Promise.all([
		highlightBlob(baseBlob, diff.file.oldPath),
		highlightBlob(headBlob, diff.file.newPath),
	])

	return {
		...diff,
		language: headHighlight?.language ?? baseHighlight?.language,
		hunks: diff.hunks.map(hunk => {
			const wordMarks = toHunkWordDiffMarks(hunk.lines)

			return {
				header: hunk.header,
				lines: hunk.lines.map((line, index) =>
					toHighlightedDiffLine(
						line,
						diff,
						baseHighlight,
						headHighlight,
						wordMarks.get(index) ?? []
					)
				),
			}
		}),
	}
}

interface HighlightPullRequestFileLinesParams {
	content: string
	endLine: number
	objectId: string
	path: string
	sha: string
	side: PullRequestThreadSide
	startLine: number
}

/**
 * A slice of one blob as context lines. Whole-file highlighting is what makes
 * the slice correct: grammar state carries into the range from above it.
 */
export async function highlightPullRequestFileLines({
	content,
	endLine,
	objectId,
	path,
	sha,
	side,
	startLine,
}: HighlightPullRequestFileLinesParams): Promise<PullRequestFileLines> {
	const contentLines = toContentLines(content)
	const highlight = await highlightSourceCode({ content, objectId, path })
	const lines = contentLines
		.slice(startLine - 1, endLine)
		.map((lineContent, index) => {
			const line = startLine + index
			const tokens = highlight?.lines[line - 1]?.tokens
			const anchor = { line, path, sha, side }

			return {
				kind: 'context' as const,
				content: lineContent,
				html: tokens && toHighlightedLineHtml(tokens),
				old: side === 'left' ? anchor : undefined,
				new: side === 'right' ? anchor : undefined,
			}
		})

	return { lines, totalLines: contentLines.length }
}

/** A file that ends in a newline has no line after it, which is how git numbers it too. */
function toContentLines(content: string) {
	const lines = content.split('\n')

	if (lines.length > 1 && lines.at(-1) === '') lines.pop()

	return lines
}

/**
 * Pairs the i-th removed line of a run with the i-th added line of the run that
 * follows it, over the length the two runs share. Runs of different lengths say
 * nothing about how their surplus lines correspond, so the surplus is left
 * unpaired rather than guessed at.
 */
function toHunkWordDiffMarks(lines: GitStorageRepositoryDiffLine[]) {
	const marks = new Map<number, SourceLineMark[]>()
	let index = 0

	while (index < lines.length) {
		const deletionStart = index

		while (lines[index]?.kind === 'deletion') index++

		const additionStart = index

		while (lines[index]?.kind === 'addition') index++

		const paired = Math.min(
			additionStart - deletionStart,
			index - additionStart
		)

		for (let offset = 0; offset < paired; offset++) {
			const deletionIndex = deletionStart + offset
			const additionIndex = additionStart + offset
			const pair = toWordDiffMarks(
				lines[deletionIndex]?.content ?? '',
				lines[additionIndex]?.content ?? ''
			)

			if (!pair) continue

			marks.set(deletionIndex, pair.deletion)
			marks.set(additionIndex, pair.addition)
		}

		if (index === deletionStart) index++
	}

	return marks
}

async function highlightBlob(
	blob: GitStorageRepositoryBlob | undefined,
	path: string
) {
	if (blob?.preview.type !== 'text') return undefined

	return await highlightSourceCode({
		content: blob.preview.content,
		objectId: blob.objectId,
		path,
	})
}

function toHighlightedDiffLine(
	line: GitStorageRepositoryDiffLine,
	diff: GitStorageRepositoryFileDiff,
	baseHighlight: HighlightedSourceCode | undefined,
	headHighlight: HighlightedSourceCode | undefined,
	wordMarks: SourceLineMark[]
): PullRequestDiffLine {
	const highlightedLine = selectHighlightedLine(
		line,
		baseHighlight,
		headHighlight
	)

	return {
		kind: line.kind,
		content: line.content,
		html: toDiffLineHtml(line.content, highlightedLine?.tokens, wordMarks),
		old: toPullRequestDiffAnchor({
			sha: diff.mergeBaseSha,
			path: diff.file.oldPath,
			line: line.oldLine,
			side: 'left',
		}),
		new: toPullRequestDiffAnchor({
			sha: diff.headSha,
			path: diff.file.newPath,
			line: line.newLine,
			side: 'right',
		}),
	}
}

/** Word marks are worth an html line of their own on files no grammar covers. */
function toDiffLineHtml(
	content: string,
	tokens: HighlightedSourceCode['lines'][number]['tokens'] | undefined,
	wordMarks: SourceLineMark[]
) {
	if (tokens) return toHighlightedLineHtml(tokens, wordMarks)
	if (wordMarks.length === 0) return undefined

	return toHighlightedLineHtml([{ content, style: '' }], wordMarks)
}

interface PullRequestDiffAnchorParams {
	line: number | undefined
	path: string
	sha: string
	side: PullRequestThreadSide
}

function toPullRequestDiffAnchor({
	line,
	path,
	sha,
	side,
}: PullRequestDiffAnchorParams) {
	if (line === undefined) return undefined

	return { line, path, sha, side }
}

function selectHighlightedLine(
	line: GitStorageRepositoryDiffLine,
	baseHighlight: HighlightedSourceCode | undefined,
	headHighlight: HighlightedSourceCode | undefined
) {
	if (line.kind === 'deletion' && line.oldLine)
		return baseHighlight?.lines[line.oldLine - 1]

	if (line.newLine) return headHighlight?.lines[line.newLine - 1]

	return undefined
}
