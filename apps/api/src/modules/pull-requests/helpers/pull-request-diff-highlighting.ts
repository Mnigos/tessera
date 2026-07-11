import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryDiffLine,
	GitStorageRepositoryFileDiff,
} from '@config/git-storage'
import type { PullRequestFileDiff } from '@repo/contracts'
import {
	type HighlightedSourceCode,
	highlightSourceCode,
} from '~/shared/helpers/source-code-highlighting'

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
		hunks: diff.hunks.map(hunk => ({
			header: hunk.header,
			lines: hunk.lines.map(line =>
				toHighlightedDiffLine(line, diff, baseHighlight, headHighlight)
			),
		})),
	}
}

async function highlightBlob(
	blob: GitStorageRepositoryBlob | undefined,
	path: string
) {
	if (blob?.preview.type !== 'text') return undefined

	return await highlightSourceCode({
		content: blob.preview.content,
		path,
	})
}

function toHighlightedDiffLine(
	line: GitStorageRepositoryDiffLine,
	diff: GitStorageRepositoryFileDiff,
	baseHighlight: HighlightedSourceCode | undefined,
	headHighlight: HighlightedSourceCode | undefined
): PullRequestFileDiff['hunks'][number]['lines'][number] {
	const highlightedLine = selectHighlightedLine(
		line,
		baseHighlight,
		headHighlight
	)

	return {
		kind: line.kind,
		content: line.content,
		lightHtml: highlightedLine?.lightHtml,
		darkHtml: highlightedLine?.darkHtml,
		old: line.oldLine
			? {
					sha: diff.mergeBaseSha,
					path: diff.file.oldPath,
					line: line.oldLine,
					side: 'left',
				}
			: undefined,
		new: line.newLine
			? {
					sha: diff.headSha,
					path: diff.file.newPath,
					line: line.newLine,
					side: 'right',
				}
			: undefined,
	}
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
