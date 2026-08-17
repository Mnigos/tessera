import type { PullRequestThreadSide } from '@repo/contracts'

/** The lines one hunk renders on one side, which a range may not grow beyond. */
export interface DiffLineHunkRange {
	startLine: number
	endLine: number
}

export interface DiffLineTarget {
	path: string
	side: PullRequestThreadSide
	line: number
	hunk: DiffLineHunkRange
}

export interface DiffLineSelection {
	path: string
	side: PullRequestThreadSide
	/** The line the range grew from, which shift-click and drag pivot on. */
	pivotLine: number
	startLine: number
	endLine: number
	hunk: DiffLineHunkRange
	/** A drag still choosing its range, which no composer should follow yet. */
	isSelecting: boolean
}

export type DiffLineSelectionAction =
	| { type: 'begin'; target: DiffLineTarget }
	| { type: 'clear' }
	| { type: 'commit' }
	| { type: 'extend'; target: DiffLineTarget }
	| { type: 'select'; target: DiffLineTarget }

// A range stays on the side, file, and hunk it began on; leaving cancels or stops at the edge.
export function reduceDiffLineSelection(
	selection: DiffLineSelection | undefined,
	action: DiffLineSelectionAction
): DiffLineSelection | undefined {
	if (action.type === 'clear') return undefined
	if (action.type === 'commit')
		return selection && { ...selection, isSelecting: false }

	const { hunk, line, path, side } = action.target

	// An extension with nothing to grow from starts the range it was aimed at.
	if (action.type !== 'extend' || !selection)
		return {
			path,
			side,
			pivotLine: line,
			startLine: line,
			endLine: line,
			hunk,
			isSelecting: action.type === 'begin',
		}

	if (selection.path !== path || selection.side !== side) return undefined

	const reached = Math.min(
		Math.max(line, selection.hunk.startLine),
		selection.hunk.endLine
	)

	return {
		...selection,
		startLine: Math.min(selection.pivotLine, reached),
		endLine: Math.max(selection.pivotLine, reached),
	}
}

export function isDiffLineSelected(
	selection: DiffLineSelection | undefined,
	target: DiffLineTarget | undefined
): boolean {
	if (!(selection && target)) return false
	if (selection.path !== target.path || selection.side !== target.side)
		return false

	return selection.startLine <= target.line && target.line <= selection.endLine
}
