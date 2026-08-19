import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadSide,
} from '@repo/contracts'
import type { PullRequestDiffView } from '../hooks/use-pull-request-diff-view-options'
import type { DiffLineHunkRange, DiffLineTarget } from './diff-line-selection'
import {
	getInlineThreadsForLine,
	getLeftoverInlineThreads,
	isLineInsideInlineThread,
} from './pull-request-inline-threads'

export type PullRequestDiffLine =
	PullRequestFileDiff['hunks'][number]['lines'][number]
type PullRequestDiffLineAnchor = NonNullable<PullRequestDiffLine['old']>

/** Lines of the file no hunk shows, numbered on the right side. */
export interface DiffGap {
	key: string
	startLine: number
	/** Absent while the file's length is unknown, which only the last gap can be. */
	endLine?: number
	/** `old − new` across the gap, so both gutters can be numbered from one fetch. */
	delta: number
}

export interface DiffSeparatorRow {
	kind: 'separator'
	key: string
	header?: string
	gap?: DiffGap
}

export interface DiffSplitRow {
	kind: 'split'
	key: string
	left?: PullRequestDiffLine
	right?: PullRequestDiffLine
	leftTarget?: DiffLineTarget
	rightTarget?: DiffLineTarget
}

export interface DiffUnifiedRow {
	kind: 'unified'
	key: string
	line: PullRequestDiffLine
	/** The side this row is numbered and commented on. */
	side: PullRequestThreadSide
	target?: DiffLineTarget
}

export interface DiffThreadSlot {
	side: PullRequestThreadSide
	line: PullRequestDiffLine
	threads: PullRequestThread[]
	/** The row must stay mounted while this is true, or the draft dies with it. */
	hasComposer: boolean
}

export interface DiffThreadRow {
	kind: 'thread'
	key: string
	left?: DiffThreadSlot
	right?: DiffThreadSlot
}

export type DiffRow =
	| DiffSeparatorRow
	| DiffSplitRow
	| DiffThreadRow
	| DiffUnifiedRow

export interface DiffExpansionSnapshot {
	/** Revealed context lines by their line number on the right side. */
	lines: ReadonlyMap<number, PullRequestDiffLine>
	totalLines?: number
}

/** The line a composer is open on, which needs a row even with no thread yet. */
export interface DiffComposerTarget {
	path: string
	side: PullRequestThreadSide
	line: number
}

export interface BuildDiffRowsInput {
	diff: PullRequestFileDiff
	threads: readonly PullRequestThread[]
	/**
	 * Sides whose line numbers mean the same thing in the anchor comparison. A
	 * thread left on any other side is listed rather than placed.
	 */
	anchorableSides: readonly PullRequestThreadSide[]
	expansion: DiffExpansionSnapshot
	view: PullRequestDiffView
	composer?: DiffComposerTarget
}

export interface DiffRowsModel {
	rows: DiffRow[]
	/** `${side}:${line}` for every line a thread's range covers. */
	commentedKeys: ReadonlySet<string>
	/** Threads no rendered line can hold, listed under the diff instead. */
	leftoverThreads: PullRequestThread[]
	gutterWidth: string
}

const NO_THREADS: PullRequestThread[] = []

/** The whole diff as one flat, indexed row list, built from data alone. */
export function buildDiffRows({
	diff,
	threads,
	anchorableSides,
	expansion,
	view,
	composer,
}: BuildDiffRowsInput): DiffRowsModel {
	const sections = toDiffSections(diff, expansion.lines, expansion.totalLines)
	const placeableThreads = threads.filter(thread =>
		thread.anchor ? anchorableSides.includes(thread.anchor.side) : false
	)
	const lineThreads = toDiffLineThreads(placeableThreads)
	const rows: DiffRow[] = []

	for (const section of sections) {
		if (section.separator)
			rows.push({
				kind: 'separator',
				key: `s:${section.key}`,
				header: section.separator.header,
				gap: section.separator.gap,
			})

		rows.push(
			...(view === 'unified'
				? toUnifiedSectionRows(section, lineThreads, composer)
				: toSplitSectionRows(section, lineThreads, composer))
		)
	}

	return {
		rows,
		commentedKeys: lineThreads.commented,
		leftoverThreads: toLeftoverThreads(
			diff,
			threads,
			placeableThreads,
			sections
		),
		gutterWidth: toGutterWidth(diff, expansion.totalLines),
	}
}

function toSplitSectionRows(
	section: DiffSection,
	lineThreads: DiffLineThreads,
	composer: DiffComposerTarget | undefined
): DiffRow[] {
	const rows: DiffRow[] = []

	for (const row of toSplitRows(section)) {
		const left = row.left
			? toThreadSlot(row.left, 'left', lineThreads, composer)
			: undefined
		const right = row.right
			? toThreadSlot(row.right, 'right', lineThreads, composer)
			: undefined

		rows.push(row)

		if (left || right)
			rows.push({ kind: 'thread', key: `${row.key}:t`, left, right })
	}

	return rows
}

function toUnifiedSectionRows(
	section: DiffSection,
	lineThreads: DiffLineThreads,
	composer: DiffComposerTarget | undefined
): DiffRow[] {
	const rows: DiffRow[] = []

	for (const line of section.lines) {
		const row = toUnifiedRow(line, section)
		const slot = toThreadSlot(line, row.side, lineThreads, composer)

		rows.push(row)

		if (slot)
			rows.push({
				kind: 'thread',
				key: `${row.key}:t`,
				left: slot.side === 'left' ? slot : undefined,
				right: slot.side === 'right' ? slot : undefined,
			})
	}

	return rows
}

/** Threads no rendered line can hold, which listing beats dropping. */
function toLeftoverThreads(
	diff: PullRequestFileDiff,
	threads: readonly PullRequestThread[],
	placeableThreads: PullRequestThread[],
	sections: DiffSection[]
): PullRequestThread[] {
	return [
		...getLeftoverInlineThreads(
			placeableThreads,
			diff,
			sections.flatMap(section => section.lines)
		),
		...threads.filter(thread => !placeableThreads.includes(thread)),
	]
}

/** Room for the widest number this diff prints, with no lane held for the button. */
export function toGutterWidth(
	diff: PullRequestFileDiff,
	totalLines?: number
): string {
	const widest = diff.hunks.reduce(
		(digits, hunk) =>
			hunk.lines.reduce(
				(hunkDigits, line) =>
					Math.max(
						hunkDigits,
						String(line.old?.line ?? '').length,
						String(line.new?.line ?? '').length
					),
				digits
			),
		Math.max(1, String(totalLines ?? '').length)
	)

	return `max(2.25rem, calc(${widest}ch + 1.25rem))`
}

export function toDiffLineKey(
	side: PullRequestThreadSide,
	line: number
): string {
	return `${side}:${line}`
}

function toThreadSlot(
	line: PullRequestDiffLine,
	side: PullRequestThreadSide,
	lineThreads: DiffLineThreads,
	composer: DiffComposerTarget | undefined
): DiffThreadSlot | undefined {
	const anchor = side === 'left' ? line.old : line.new

	if (!anchor) return undefined

	const threads = lineThreads.byEndLine.get(toDiffLineKey(side, anchor.line))
	const hasComposer =
		composer?.side === side &&
		composer.line === anchor.line &&
		composer.path === anchor.path

	if (!(threads || hasComposer)) return undefined

	return { side, line, threads: threads ?? NO_THREADS, hasComposer }
}

/** The line numbers a run of rows covers on one side, absent when it covers none. */
function toHunkRange(
	lines: PullRequestDiffLine[],
	side: PullRequestThreadSide
): DiffLineHunkRange | undefined {
	const numbers = lines.flatMap(line => {
		const anchor = side === 'left' ? line.old : line.new

		return anchor ? [anchor.line] : []
	})

	if (numbers.length === 0) return undefined

	return { startLine: Math.min(...numbers), endLine: Math.max(...numbers) }
}

function toDiffLineTarget(
	anchor: PullRequestDiffLineAnchor | undefined,
	side: PullRequestThreadSide,
	hunk: DiffLineHunkRange | undefined
): DiffLineTarget | undefined {
	if (!(anchor && hunk)) return undefined

	return { hunk, line: anchor.line, path: anchor.path, side }
}

interface DiffLineThreads {
	byEndLine: Map<string, PullRequestThread[]>
	commented: Set<string>
}

function toDiffLineThreads(threads: PullRequestThread[]): DiffLineThreads {
	const byEndLine = new Map<string, PullRequestThread[]>()
	const commented = new Set<string>()

	for (const { anchor } of threads) {
		if (!anchor) continue

		const endKey = toDiffLineKey(anchor.side, anchor.endLine)

		if (!byEndLine.has(endKey)) {
			const ended = getInlineThreadsForLine(
				threads,
				anchor.side,
				anchor.endLine
			)

			if (ended.length > 0) byEndLine.set(endKey, ended)
		}

		for (let line = anchor.startLine; line <= anchor.endLine; line += 1)
			if (isLineInsideInlineThread(threads, anchor.side, line))
				commented.add(toDiffLineKey(anchor.side, line))
	}

	return { byEndLine, commented }
}

interface DiffSeparator {
	/** The `@@` bar, absent on the expander that closes the file. */
	header?: string
	/** What is left to reveal, absent once the gap is gone. */
	gap?: DiffGap
}

/**
 * A run of rows with no hidden line inside it. A drag may cross the whole run
 * and no further, which is what keeps a range from covering unseen lines.
 */
interface DiffSection {
	key: string
	separator?: DiffSeparator
	lines: PullRequestDiffLine[]
	leftRange?: DiffLineHunkRange
	rightRange?: DiffLineHunkRange
}

interface HunkBounds {
	newStart?: number
	newEnd?: number
	leadDelta?: number
	trailDelta?: number
}

function toHunkBounds(lines: PullRequestDiffLine[]): HunkBounds {
	const bounds: HunkBounds = {}

	for (const line of lines) {
		if (line.new) {
			bounds.newStart ??= line.new.line
			bounds.newEnd = line.new.line
		}

		if (line.old && line.new) {
			const delta = line.old.line - line.new.line

			bounds.leadDelta ??= delta
			bounds.trailDelta = delta
		}
	}

	return bounds
}

interface RevealContext {
	expanded: ReadonlyMap<number, PullRequestDiffLine>
	oldPath: string
	mergeBaseSha: string
}

function toRevealedLine(
	line: PullRequestDiffLine,
	oldLine: number,
	{ mergeBaseSha, oldPath }: RevealContext
): PullRequestDiffLine {
	return {
		...line,
		old: { line: oldLine, path: oldPath, sha: mergeBaseSha, side: 'left' },
	}
}

/** Rows already revealed downward from the top of a gap. */
function toLeadingReveal(gap: DiffGap, context: RevealContext) {
	const lines: PullRequestDiffLine[] = []

	for (
		let line = gap.startLine;
		gap.endLine === undefined || line <= gap.endLine;
		line += 1
	) {
		const revealed = context.expanded.get(line)

		if (!revealed) break

		lines.push(toRevealedLine(revealed, line + gap.delta, context))
	}

	return lines
}

/** Rows already revealed upward from the bottom of a gap. */
function toTrailingReveal(gap: DiffGap, context: RevealContext, taken: number) {
	if (gap.endLine === undefined) return []

	const lines: PullRequestDiffLine[] = []

	for (let line = gap.endLine; line >= gap.startLine + taken; line -= 1) {
		const revealed = context.expanded.get(line)

		if (!revealed) break

		lines.unshift(toRevealedLine(revealed, line + gap.delta, context))
	}

	return lines
}

function toRemainingGap(
	gap: DiffGap,
	leading: number,
	trailing: number,
	totalLines: number | undefined
): DiffGap | undefined {
	const startLine = gap.startLine + leading
	const endLine =
		gap.endLine === undefined ? totalLines : gap.endLine - trailing

	if (endLine !== undefined && endLine < startLine) return undefined

	return { ...gap, startLine, endLine }
}

/**
 * Hunks, plus whatever of the gaps between them has been revealed, split into
 * runs of adjacent lines. Consecutive runs with nothing hidden between them are
 * one section, so a fully revealed gap reads — and selects — as one block.
 */
function toDiffSections(
	diff: PullRequestFileDiff,
	expanded: ReadonlyMap<number, PullRequestDiffLine>,
	totalLines: number | undefined
): DiffSection[] {
	const context: RevealContext = {
		expanded,
		mergeBaseSha: diff.mergeBaseSha,
		oldPath: diff.file.oldPath,
	}
	const bounds = diff.hunks.map(hunk => toHunkBounds(hunk.lines))
	const sections: DiffSection[] = []

	function pushLines(lines: PullRequestDiffLine[]) {
		if (lines.length === 0) return

		const current = sections.at(-1)

		if (current) current.lines.push(...lines)
		else sections.push({ key: 'head', lines: [...lines] })
	}

	function pushSeparator(key: string, separator: DiffSeparator) {
		sections.push({ key, separator, lines: [] })
	}

	diff.hunks.forEach((hunk, index) => {
		const gap = toHunkGap(bounds, index)

		if (!gap) {
			pushSeparator(`hunk-${index}`, { header: hunk.header })
			pushLines(hunk.lines)

			return
		}

		const leading = toLeadingReveal(gap, context)
		const trailing = toTrailingReveal(gap, context, leading.length)
		const remaining = toRemainingGap(
			gap,
			leading.length,
			trailing.length,
			totalLines
		)

		pushLines(leading)

		if (remaining)
			pushSeparator(`hunk-${index}`, { header: hunk.header, gap: remaining })

		pushLines(trailing)
		pushLines(hunk.lines)
	})

	const tailGap = toTailGap(bounds.at(-1))

	if (tailGap) {
		const leading = toLeadingReveal(tailGap, context)
		const remaining = toRemainingGap(tailGap, leading.length, 0, totalLines)

		pushLines(leading)

		if (remaining) pushSeparator('tail', { gap: remaining })
	}

	for (const section of sections) {
		section.leftRange = toHunkRange(section.lines, 'left')
		section.rightRange = toHunkRange(section.lines, 'right')
	}

	return sections
}

function toHunkGap(bounds: HunkBounds[], index: number): DiffGap | undefined {
	const current = bounds[index]
	const previous = index === 0 ? undefined : bounds[index - 1]
	const startLine =
		index === 0
			? 1
			: previous?.newEnd === undefined
				? undefined
				: previous.newEnd + 1
	const endLine =
		current?.newStart === undefined ? undefined : current.newStart - 1
	const delta = current?.leadDelta ?? previous?.trailDelta

	if (
		startLine === undefined ||
		endLine === undefined ||
		delta === undefined ||
		startLine > endLine
	)
		return undefined

	return { key: `gap-${startLine}`, startLine, endLine, delta }
}

function toTailGap(last: HunkBounds | undefined): DiffGap | undefined {
	if (last?.newEnd === undefined || last.trailDelta === undefined)
		return undefined

	return {
		key: 'gap-tail',
		startLine: last.newEnd + 1,
		delta: last.trailDelta,
	}
}

function toSplitRows(section: DiffSection): DiffSplitRow[] {
	return getSplitDiffRows(section.lines).map(row => ({
		kind: 'split',
		key: `l:${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}`,
		left: row.left,
		right: row.right,
		leftTarget: toDiffLineTarget(row.left?.old, 'left', section.leftRange),
		rightTarget: toDiffLineTarget(row.right?.new, 'right', section.rightRange),
	}))
}

/** Patch order, so a run's deletions read before the additions replacing them. */
function toUnifiedRow(
	line: PullRequestDiffLine,
	section: DiffSection
): DiffUnifiedRow {
	const side: PullRequestThreadSide =
		line.kind === 'deletion' ? 'left' : 'right'

	return {
		kind: 'unified',
		key: `u:${line.old?.line ?? '-'}:${line.new?.line ?? '-'}`,
		line,
		side,
		target: toDiffLineTarget(
			side === 'left' ? line.old : line.new,
			side,
			side === 'left' ? section.leftRange : section.rightRange
		),
	}
}

interface SplitDiffRow {
	left?: PullRequestDiffLine
	right?: PullRequestDiffLine
}

function getSplitDiffRows(lines: PullRequestDiffLine[]): SplitDiffRow[] {
	const rows: SplitDiffRow[] = []
	let lineIndex = 0

	while (lineIndex < lines.length) {
		const line = lines[lineIndex]
		if (!line) break

		if (line.kind === 'context') {
			rows.push({ left: line, right: line })
			lineIndex += 1
			continue
		}

		const deletions: PullRequestDiffLine[] = []
		const additions: PullRequestDiffLine[] = []

		while (lineIndex < lines.length) {
			const changedLine = lines[lineIndex]
			if (!changedLine || changedLine.kind === 'context') break

			if (changedLine.kind === 'deletion') deletions.push(changedLine)
			else additions.push(changedLine)
			lineIndex += 1
		}

		const rowCount = Math.max(deletions.length, additions.length)
		for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1)
			rows.push({
				left: deletions[rowIndex],
				right: additions[rowIndex],
			})
	}

	return rows
}
