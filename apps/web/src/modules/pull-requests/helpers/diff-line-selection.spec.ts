import type { PullRequestThreadSide } from '@repo/contracts'
import {
	type DiffLineSelection,
	type DiffLineTarget,
	isDiffLineSelected,
	reduceDiffLineSelection,
} from './diff-line-selection'

const HUNK = { startLine: 1, endLine: 5 }

function target(
	line: number,
	path = 'src/index.ts',
	side: PullRequestThreadSide = 'right',
	hunk = HUNK
): DiffLineTarget {
	return { hunk, line, path, side }
}

function selection(line = 3): DiffLineSelection {
	return {
		path: 'src/index.ts',
		side: 'right',
		hunk: HUNK,
		pivotLine: line,
		startLine: line,
		endLine: line,
		isSelecting: false,
	}
}

describe(reduceDiffLineSelection.name, () => {
	test('selects one committed line', () => {
		expect(
			reduceDiffLineSelection(undefined, { type: 'select', target: target(3) })
		).toEqual(selection())
	})

	test.each([
		[5, 3, 5],
		[1, 1, 3],
	] as const)('orders a shift extension from the pivot through line %s', (line, startLine, endLine) => {
		expect(
			reduceDiffLineSelection(selection(), {
				type: 'extend',
				target: target(line),
			})
		).toEqual({ ...selection(), startLine, endLine })
	})

	test('begins, extends, and commits a pointer range', () => {
		const begun = reduceDiffLineSelection(undefined, {
			type: 'begin',
			target: target(2),
		})
		expect(begun?.isSelecting).toBeTruthy()

		const extended = reduceDiffLineSelection(begun, {
			type: 'extend',
			target: target(4),
		})
		expect(extended).toMatchObject({ startLine: 2, endLine: 4 })

		const committed = reduceDiffLineSelection(extended, { type: 'commit' })
		expect(committed?.isSelecting).toBeFalsy()
	})

	test.each([
		['another path', target(4, 'src/other.ts')],
		['another side', target(4, 'src/index.ts', 'left')],
	] as const)('cancels an extension onto %s', (_name, nextTarget) => {
		expect(
			reduceDiffLineSelection(selection(), {
				type: 'extend',
				target: nextTarget,
			})
		).toBeUndefined()
	})

	test.each([
		[8, 5],
		[-2, 1],
	] as const)('clamps line %s to the original hunk edge', (line, endLine) => {
		const current = selection(3)

		expect(
			reduceDiffLineSelection(current, {
				type: 'extend',
				target: target(line, 'src/index.ts', 'right', {
					startLine: 8,
					endLine: 12,
				}),
			})
		).toMatchObject({
			startLine: Math.min(3, endLine),
			endLine: Math.max(3, endLine),
		})
	})

	test('clears the selection', () => {
		expect(
			reduceDiffLineSelection(selection(), { type: 'clear' })
		).toBeUndefined()
	})
})

describe(isDiffLineSelected.name, () => {
	test('matches every line inside the selected path and side only', () => {
		const range = { ...selection(), startLine: 2, endLine: 4 }

		expect(isDiffLineSelected(range, target(2))).toBeTruthy()
		expect(isDiffLineSelected(range, target(4))).toBeTruthy()
		expect(isDiffLineSelected(range, target(5))).toBeFalsy()
		expect(isDiffLineSelected(range, target(3, 'src/other.ts'))).toBeFalsy()
		expect(
			isDiffLineSelected(range, target(3, 'src/index.ts', 'left'))
		).toBeFalsy()
	})
})
