import type {
	PullRequestChangedFile,
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadId,
	PullRequestThreadSide,
} from '@repo/contracts'
import {
	type BuildDiffRowsInput,
	buildDiffRows,
	type DiffRow,
	type DiffSplitRow,
	type DiffThreadRow,
	type DiffUnifiedRow,
	type PullRequestDiffLine,
	toGutterWidth,
} from './pull-request-diff-rows'

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MERGE_BASE_SHA = 'c'.repeat(40)
const PATH = 'src/app.ts'

function contextLine(
	oldLine: number,
	newLine: number,
	content = `context ${newLine}`
): PullRequestDiffLine {
	return {
		kind: 'context',
		content,
		old: { line: oldLine, path: PATH, sha: MERGE_BASE_SHA, side: 'left' },
		new: { line: newLine, path: PATH, sha: HEAD_SHA, side: 'right' },
	}
}

function deletionLine(oldLine: number): PullRequestDiffLine {
	return {
		kind: 'deletion',
		content: `removed ${oldLine}`,
		old: { line: oldLine, path: PATH, sha: MERGE_BASE_SHA, side: 'left' },
	}
}

function additionLine(newLine: number): PullRequestDiffLine {
	return {
		kind: 'addition',
		content: `added ${newLine}`,
		new: { line: newLine, path: PATH, sha: HEAD_SHA, side: 'right' },
	}
}

/** A right-side blob slice, which is what the expansion store holds. */
function revealedLine(newLine: number): PullRequestDiffLine {
	return {
		kind: 'context',
		content: `hidden ${newLine}`,
		new: { line: newLine, path: PATH, sha: HEAD_SHA, side: 'right' },
	}
}

const changedFile = {
	status: 'modified',
	oldPath: PATH,
	newPath: PATH,
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	additions: 2,
	deletions: 1,
	isBinary: false,
} satisfies PullRequestChangedFile

function fileDiff(
	hunks: PullRequestFileDiff['hunks'],
	file: PullRequestChangedFile = changedFile
): PullRequestFileDiff {
	return {
		baseSha: BASE_SHA,
		headSha: HEAD_SHA,
		mergeBaseSha: MERGE_BASE_SHA,
		file,
		hunks,
		isTruncated: false,
		patchLimitBytes: 1_000_000,
	}
}

/**
 * Two hunks with lines 4–9 hidden between them and an open tail, which is the
 * shape every expansion and separator assertion below leans on.
 */
const twoHunkDiff = fileDiff([
	{
		header: '@@ -1,3 +1,3 @@',
		lines: [
			contextLine(1, 1),
			deletionLine(2),
			additionLine(2),
			contextLine(3, 3),
		],
	},
	{
		header: '@@ -10,2 +10,2 @@',
		lines: [contextLine(10, 10), additionLine(11)],
	},
])

function thread(
	id: string,
	side: PullRequestThreadSide,
	startLine: number,
	endLine: number,
	path = PATH
): PullRequestThread {
	return {
		id: id as PullRequestThreadId,
		kind: 'inline',
		anchor: {
			path,
			side,
			startLine,
			endLine,
			anchorSha: side === 'left' ? MERGE_BASE_SHA : HEAD_SHA,
			baseSha: BASE_SHA,
			headSha: HEAD_SHA,
			lineExcerpt: 'excerpt',
		},
		currentAnchor: { path, side, startLine, endLine },
		outdated: false,
		createdAt: new Date('2026-08-19T10:00:00.000Z'),
		comments: [],
	}
}

const BOTH_SIDES: readonly PullRequestThreadSide[] = ['left', 'right']

function build(overrides: Partial<BuildDiffRowsInput> = {}) {
	return buildDiffRows({
		anchorableSides: BOTH_SIDES,
		diff: twoHunkDiff,
		expansion: { lines: new Map() },
		threads: [],
		view: 'split',
		...overrides,
	})
}

function keysOf(rows: DiffRow[]) {
	return rows.map(row => row.key)
}

function splitRows(rows: DiffRow[]) {
	return rows.filter((row): row is DiffSplitRow => row.kind === 'split')
}

function threadRows(rows: DiffRow[]) {
	return rows.filter((row): row is DiffThreadRow => row.kind === 'thread')
}

function unifiedRows(rows: DiffRow[]) {
	return rows.filter((row): row is DiffUnifiedRow => row.kind === 'unified')
}

describe('buildDiffRows', () => {
	test('opens every hunk with its own separator row', () => {
		const { rows } = build()

		expect(keysOf(rows)).toEqual([
			's:hunk-0',
			'l:1:1',
			'l:2:2',
			'l:3:3',
			's:hunk-1',
			'l:10:10',
			'l:-:11',
			's:tail',
		])
		expect(rows[0]).toMatchObject({
			kind: 'separator',
			header: '@@ -1,3 +1,3 @@',
		})
	})

	test('pairs a deletion run with the additions replacing it', () => {
		const { rows } = build()
		const changed = splitRows(rows).find(row => row.key === 'l:2:2')

		expect(changed?.left?.kind).toBe('deletion')
		expect(changed?.right?.kind).toBe('addition')
	})

	test('renders no rows for a diff with no hunks', () => {
		const { rows, leftoverThreads } = build({
			diff: fileDiff([]),
			threads: [thread('thread-1', 'right', 3, 3)],
		})

		expect(rows).toEqual([])
		expect(leftoverThreads.map(({ id }) => id)).toEqual(['thread-1'])
	})

	test('clamps a run to the lines it shows, so a drag cannot cross a gap', () => {
		const { rows } = build()
		const before = splitRows(rows).find(row => row.key === 'l:3:3')
		const after = splitRows(rows).find(row => row.key === 'l:10:10')

		expect(before?.rightTarget?.hunk).toEqual({ startLine: 1, endLine: 3 })
		expect(after?.rightTarget?.hunk).toEqual({ startLine: 10, endLine: 11 })
	})

	describe('expansion', () => {
		test('puts a gap only on a separator row, never between lines', () => {
			const { rows } = build()
			const gapped = rows.filter(row => row.kind === 'separator' && row.gap)

			expect(gapped.map(row => row.key)).toEqual(['s:hunk-1', 's:tail'])
			expect(gapped[0]).toMatchObject({
				gap: { key: 'gap-4', startLine: 4, endLine: 9, delta: 0 },
			})
			// The file's length is unknown until a fetch reports it.
			expect(gapped[1]).toMatchObject({
				gap: { startLine: 12, endLine: undefined },
			})
			expect(gapped[1]).toMatchObject({ header: undefined })
		})

		test('splices revealed lines in and keeps the gap on what is left', () => {
			const { rows } = build({
				expansion: { lines: new Map([[4, revealedLine(4)]]) },
			})

			expect(keysOf(rows).slice(0, 6)).toEqual([
				's:hunk-0',
				'l:1:1',
				'l:2:2',
				'l:3:3',
				'l:4:4',
				's:hunk-1',
			])
			expect(rows[5]).toMatchObject({
				gap: { startLine: 5, endLine: 9 },
			})
		})

		test('merges the sections either side once a gap is fully revealed', () => {
			const { rows } = build({
				expansion: {
					lines: new Map(
						[4, 5, 6, 7, 8, 9].map(line => [line, revealedLine(line)])
					),
				},
			})
			const separators = rows.filter(row => row.kind === 'separator')

			expect(separators.map(row => row.key)).toEqual(['s:hunk-0', 's:tail'])
			// One run now, so a drag may cover every line either side of the old gap.
			expect(
				splitRows(rows).find(row => row.key === 'l:5:5')?.rightTarget?.hunk
			).toEqual({ startLine: 1, endLine: 11 })
			expect(
				splitRows(rows).find(row => row.key === 'l:1:1')?.rightTarget?.hunk
			).toEqual({ startLine: 1, endLine: 11 })
		})

		test('numbers a revealed line on both sides from the gap delta', () => {
			const shifted = fileDiff([
				{
					header: '@@ -1,1 +1,1 @@',
					lines: [contextLine(1, 1), additionLine(2)],
				},
				{
					header: '@@ -3,1 +4,1 @@',
					lines: [contextLine(3, 4)],
				},
			])
			const { rows } = build({
				diff: shifted,
				expansion: { lines: new Map([[3, revealedLine(3)]]) },
			})
			const revealed = splitRows(rows).find(row => row.key === 'l:2:3')

			expect(revealed?.left?.old).toMatchObject({ line: 2, path: PATH })
			expect(revealed?.right?.new).toMatchObject({ line: 3 })
		})

		test('closes the tail gap once the file length is known', () => {
			const { rows } = build({
				expansion: {
					lines: new Map([[12, revealedLine(12)]]),
					totalLines: 12,
				},
			})

			expect(rows.some(row => row.key === 's:tail')).toBe(false)
			expect(keysOf(rows).at(-1)).toBe('l:12:12')
		})

		test('anchors a revealed line to the renamed file it came from', () => {
			const renamed = {
				...changedFile,
				status: 'renamed',
				oldPath: 'src/old.ts',
			} satisfies PullRequestChangedFile
			const { rows } = build({
				diff: fileDiff(twoHunkDiff.hunks, renamed),
				expansion: { lines: new Map([[4, revealedLine(4)]]) },
			})
			const revealed = splitRows(rows).find(row => row.key === 'l:4:4')

			expect(revealed?.left?.old).toEqual({
				line: 4,
				path: 'src/old.ts',
				sha: MERGE_BASE_SHA,
				side: 'left',
			})
		})
	})

	describe('thread placement', () => {
		test('hangs a right-side thread under the row ending its range', () => {
			const { rows } = build({ threads: [thread('thread-1', 'right', 1, 3)] })
			const index = rows.findIndex(row => row.kind === 'thread')

			expect(rows[index - 1]?.key).toBe('l:3:3')
			expect(threadRows(rows)[0]?.right?.threads.map(({ id }) => id)).toEqual([
				'thread-1',
			])
			expect(threadRows(rows)[0]?.left).toBeUndefined()
		})

		test('hangs a left-side thread under the deleted line it discusses', () => {
			const { rows } = build({ threads: [thread('thread-1', 'left', 2, 2)] })
			const index = rows.findIndex(row => row.kind === 'thread')

			expect(rows[index - 1]?.key).toBe('l:2:2')
			expect(threadRows(rows)[0]?.left?.threads).toHaveLength(1)
			expect(threadRows(rows)[0]?.right).toBeUndefined()
		})

		test('shares one row between both columns of a replaced line', () => {
			const { rows } = build({
				threads: [
					thread('left-1', 'left', 2, 2),
					thread('right-1', 'right', 2, 2),
				],
			})

			expect(threadRows(rows)).toHaveLength(1)
			expect(threadRows(rows)[0]?.left?.side).toBe('left')
			expect(threadRows(rows)[0]?.right?.side).toBe('right')
		})

		test('marks every line a range covers as commented', () => {
			const { commentedKeys } = build({
				threads: [thread('thread-1', 'right', 1, 3)],
			})

			expect([...commentedKeys].sort()).toEqual([
				'right:1',
				'right:2',
				'right:3',
			])
		})

		test('lists a thread whose side this diff cannot number', () => {
			const { rows, leftoverThreads } = build({
				anchorableSides: ['right'],
				threads: [thread('thread-1', 'left', 2, 2)],
			})

			expect(threadRows(rows)).toHaveLength(0)
			expect(leftoverThreads.map(({ id }) => id)).toEqual(['thread-1'])
		})

		test('lists a thread anchored to a line no hunk shows', () => {
			const { rows, leftoverThreads } = build({
				threads: [thread('thread-1', 'right', 7, 7)],
			})

			expect(threadRows(rows)).toHaveLength(0)
			expect(leftoverThreads.map(({ id }) => id)).toEqual(['thread-1'])
		})

		test('places a thread on a line an expanded gap revealed', () => {
			const { rows, leftoverThreads } = build({
				expansion: { lines: new Map([[4, revealedLine(4)]]) },
				threads: [thread('thread-1', 'right', 4, 4)],
			})
			const index = rows.findIndex(row => row.kind === 'thread')

			expect(rows[index - 1]?.key).toBe('l:4:4')
			expect(leftoverThreads).toEqual([])
		})
	})

	describe('composer', () => {
		test('opens a row on a line with no thread on it yet', () => {
			const { rows } = build({
				composer: { path: PATH, side: 'right', line: 3 },
			})
			const index = rows.findIndex(row => row.kind === 'thread')

			expect(rows[index - 1]?.key).toBe('l:3:3')
			expect(threadRows(rows)[0]?.right).toMatchObject({
				hasComposer: true,
				threads: [],
			})
		})

		test('joins the row a thread already holds', () => {
			const { rows } = build({
				composer: { path: PATH, side: 'right', line: 3 },
				threads: [thread('thread-1', 'right', 3, 3)],
			})

			expect(threadRows(rows)).toHaveLength(1)
			expect(threadRows(rows)[0]?.right).toMatchObject({
				hasComposer: true,
			})
			expect(threadRows(rows)[0]?.right?.threads).toHaveLength(1)
		})

		test('ignores a composer left on another file', () => {
			const { rows } = build({
				composer: { path: 'src/other.ts', side: 'right', line: 3 },
			})

			expect(threadRows(rows)).toHaveLength(0)
		})
	})

	describe('unified view', () => {
		test('keeps patch order, so deletions read before their replacements', () => {
			const { rows } = build({ view: 'unified' })

			expect(keysOf(rows)).toEqual([
				's:hunk-0',
				'u:1:1',
				'u:2:-',
				'u:-:2',
				'u:3:3',
				's:hunk-1',
				'u:10:10',
				'u:-:11',
				's:tail',
			])
		})

		test('numbers a deletion on the left and everything else on the right', () => {
			const { rows } = build({ view: 'unified' })
			const sides = unifiedRows(rows).map(row => [row.key, row.side])

			expect(sides).toEqual([
				['u:1:1', 'right'],
				['u:2:-', 'left'],
				['u:-:2', 'right'],
				['u:3:3', 'right'],
				['u:10:10', 'right'],
				['u:-:11', 'right'],
			])
		})

		test('puts a thread under the single row that owns its side', () => {
			const { rows } = build({
				threads: [thread('thread-1', 'left', 2, 2)],
				view: 'unified',
			})
			const index = rows.findIndex(row => row.kind === 'thread')

			expect(rows[index - 1]?.key).toBe('u:2:-')
			expect(threadRows(rows)[0]?.left?.threads).toHaveLength(1)
			expect(threadRows(rows)[0]?.right).toBeUndefined()
		})

		test('keeps every row key unique across the file', () => {
			const { rows } = build({ view: 'unified' })

			expect(new Set(keysOf(rows)).size).toBe(rows.length)
		})
	})
})

describe('toGutterWidth', () => {
	test('makes room for the widest line number a hunk prints', () => {
		expect(toGutterWidth(twoHunkDiff)).toBe('max(2.25rem, calc(2ch + 1.25rem))')
	})

	test('makes room for the file length once a gap has reported it', () => {
		expect(toGutterWidth(twoHunkDiff, 1234)).toBe(
			'max(2.25rem, calc(4ch + 1.25rem))'
		)
	})
})
