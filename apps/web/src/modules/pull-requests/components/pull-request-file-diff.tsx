import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadSide,
} from '@repo/contracts'
import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import {
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	Loader2,
	Plus,
} from 'lucide-react'
import {
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useMemo,
} from 'react'
import {
	type DiffLineHunkRange,
	type DiffLineSelection,
	type DiffLineSelectionAction,
	type DiffLineTarget,
	isDiffLineSelected,
} from '../helpers/diff-line-selection'
import { isPullRequestStaleComparisonError } from '../helpers/get-pull-request-error-message'
import {
	getInlineThreadsForLine,
	getLeftoverInlineThreads,
	isLineInsideInlineThread,
	toThreadLineExcerpt,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import type { PullRequestDiffView } from '../hooks/use-pull-request-diff-view-options'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import {
	type PullRequestFileExpansion,
	type PullRequestFileExpansionRequest,
	usePullRequestFileExpansion,
} from '../hooks/use-pull-request-file-expansion'
import { usePullRequestDiffSelection } from './pull-request-diff-selection-context'
import {
	PullRequestDiffThreadRow,
	PullRequestOutdatedThreads,
} from './pull-request-file-threads'

/** The base and head a thread records itself against. */
export interface PullRequestDiffAnchorComparison {
	baseSha: string
	headSha: string
}

interface PullRequestFileDiffViewProps {
	expectedBaseSha: string
	expectedHeadSha: string
	/**
	 * Where threads made here belong, which is the pull request's own comparison
	 * even when the diff on screen is a narrower one.
	 */
	anchorComparison: PullRequestDiffAnchorComparison
	/**
	 * Sides of this diff whose line numbers mean the same thing in the anchor
	 * comparison. Threads are placed on those sides and opened from them; a side
	 * left out is numbered against something else entirely.
	 */
	anchorableSides: readonly PullRequestThreadSide[]
	username: string
	slug: string
	number: string
	path: string
	view: PullRequestDiffView
	isWrapped: boolean
	permissions: PullRequestThreadPermissions
	threads: PullRequestThread[]
}

function FileDiffView({
	expectedBaseSha,
	expectedHeadSha,
	anchorComparison,
	anchorableSides,
	username,
	slug,
	number,
	path,
	view,
	isWrapped,
	permissions,
	threads,
}: Readonly<PullRequestFileDiffViewProps>) {
	const diffInput = useMemo(
		() => ({ expectedBaseSha, expectedHeadSha, username, slug, number, path }),
		[expectedBaseSha, expectedHeadSha, number, path, slug, username]
	)
	const diffQuery = usePullRequestFileDiffQuery(diffInput, true)
	const expansion = usePullRequestFileExpansion(diffInput)

	if (diffQuery.isLoading)
		return <div className="h-24 animate-pulse bg-muted/40" />

	if (diffQuery.isError)
		return (
			<div>
				<p className="p-3 text-destructive text-sm">
					The file diff could not be loaded.
				</p>
				{threads.length > 0 && (
					<PullRequestOutdatedThreads
						number={number}
						permissions={permissions}
						slug={slug}
						threads={threads}
						title="Comments"
						username={username}
					/>
				)}
			</div>
		)

	if (!diffQuery.data)
		return threads.length > 0 ? (
			<PullRequestOutdatedThreads
				number={number}
				permissions={permissions}
				slug={slug}
				threads={threads}
				title="Comments"
				username={username}
			/>
		) : null

	return (
		<FileDiff
			anchorableSides={anchorableSides}
			anchorComparison={anchorComparison}
			diff={diffQuery.data}
			expansion={expansion}
			isWrapped={isWrapped}
			number={number}
			permissions={permissions}
			slug={slug}
			threads={threads}
			username={username}
			view={view}
		/>
	)
}

// Every mounted file would re-render on any files-view state change otherwise.
export const PullRequestFileDiffView = memo(FileDiffView)

interface FileDiffProps {
	diff: PullRequestFileDiff
	anchorComparison: PullRequestDiffAnchorComparison
	anchorableSides: readonly PullRequestThreadSide[]
	expansion: PullRequestFileExpansion
	view: PullRequestDiffView
	isWrapped: boolean
	threads: PullRequestThread[]
	permissions: PullRequestThreadPermissions
	username: string
	slug: string
	number: string
}

function FileDiff({
	diff,
	anchorComparison,
	anchorableSides,
	expansion,
	view,
	isWrapped,
	threads,
	permissions,
	username,
	slug,
	number,
}: Readonly<FileDiffProps>) {
	const [selection, dispatchSelection] = usePullRequestDiffSelection(diff.file)
	const sections = useMemo(
		() => toDiffSections(diff, expansion.lines, expansion.totalLines),
		[diff, expansion.lines, expansion.totalLines]
	)
	// Splitting lines into rows costs more than rendering them, so it runs once.
	const renderedSections = useMemo(
		() =>
			sections.map(section => ({
				key: section.key,
				separator: section.separator,
				splitRows: view === 'unified' ? NO_SPLIT_ROWS : toSplitRows(section),
				unifiedRows:
					view === 'unified' ? toUnifiedRows(section) : NO_UNIFIED_ROWS,
			})),
		[sections, view]
	)
	const placeableThreads = useMemo(
		() =>
			threads.filter(thread =>
				thread.anchor ? anchorableSides.includes(thread.anchor.side) : false
			),
		[anchorableSides, threads]
	)
	// A thread this diff cannot place is listed below rather than dropped: the
	// side it was left on is numbered against a base this diff never had.
	const leftoverThreads = useMemo(
		() => [
			...getLeftoverInlineThreads(
				placeableThreads,
				diff,
				sections.flatMap(section => section.lines)
			),
			...threads.filter(thread => !placeableThreads.includes(thread)),
		],
		[diff, placeableThreads, sections, threads]
	)
	const lineThreads = useMemo(
		() => toDiffLineThreads(placeableThreads),
		[placeableThreads]
	)
	const clearSelection = useCallback(
		() => dispatchSelection({ type: 'clear' }),
		[dispatchSelection]
	)
	const onSelect = permissions.canComment ? dispatchSelection : undefined
	const rowContext = useMemo<DiffRowContext>(
		() => ({
			isWrapped,
			number,
			onComposerDone: clearSelection,
			onSelectLeft: anchorableSides.includes('left') ? onSelect : undefined,
			onSelectRight: anchorableSides.includes('right') ? onSelect : undefined,
			permissions,
			slug,
			username,
		}),
		[
			anchorableSides,
			clearSelection,
			isWrapped,
			number,
			onSelect,
			permissions,
			slug,
			username,
		]
	)

	if (diff.file.isBinary)
		return (
			<p className="p-3 text-muted-foreground text-sm">
				Binary file changed. A text diff is unavailable.
			</p>
		)

	if (diff.hunks.length === 0)
		return (
			<div>
				<p className="p-3 text-muted-foreground text-sm">
					No text changes to display.
				</p>
				{threads.length > 0 && (
					<PullRequestOutdatedThreads
						number={number}
						permissions={permissions}
						slug={slug}
						threads={threads}
						title="Comments"
						username={username}
					/>
				)}
			</div>
		)

	function toRowProps(row: DiffRowModel) {
		return {
			context: rowContext,
			isLeftCommented: lineThreads.commented.has(toDiffLineKey(row.leftTarget)),
			isLeftSelected: isDiffLineSelected(selection, row.leftTarget),
			isRightCommented: lineThreads.commented.has(
				toDiffLineKey(row.rightTarget)
			),
			isRightSelected: isDiffLineSelected(selection, row.rightTarget),
			leftAnchor: toSelectionAnchor(
				anchorComparison,
				selection,
				row.left,
				'left'
			),
			leftThreads: lineThreads.byEndLine.get(toDiffLineKey(row.leftTarget)),
			rightAnchor: toSelectionAnchor(
				anchorComparison,
				selection,
				row.right,
				'right'
			),
			rightThreads: lineThreads.byEndLine.get(toDiffLineKey(row.rightTarget)),
			row,
		}
	}

	return (
		// biome-ignore lint/a11y: Escape only shortcuts the composer's own Cancel button
		<div
			className="bg-background"
			onKeyDown={event => {
				if (event.key === 'Escape') clearSelection()
			}}
		>
			{diff.isTruncated && (
				<p className="border-border border-b px-2 py-1 text-amber-300 text-xs">
					Diff truncated at {diff.patchLimitBytes.toLocaleString()} bytes.
				</p>
			)}
			<div
				className={cn(
					"font-mono text-[13px] leading-[22px] [font-feature-settings:'liga'_0,'calt'_0] [font-variant-ligatures:none] [tab-size:2]",
					!isWrapped && 'overflow-x-auto'
				)}
				data-diff-code
				style={
					{
						'--diff-gutter': toGutterWidth(diff, expansion.totalLines),
						'--diff-code-pad': '1.25rem',
					} as CSSProperties
				}
			>
				{/* Unwrapped code sets the width, so every row scrolls as one block. */}
				<div className={cn(!isWrapped && 'w-max min-w-full')}>
					{renderedSections.map(section => (
						<div key={section.key}>
							{section.separator && (
								<DiffSeparatorRow
									expansion={expansion}
									gap={section.separator.gap}
									header={section.separator.header}
								/>
							)}
							{view === 'unified'
								? section.unifiedRows.map(row => (
										<UnifiedDiffRow
											anchor={toSelectionAnchor(
												anchorComparison,
												selection,
												row.line,
												row.side
											)}
											context={rowContext}
											isCommented={lineThreads.commented.has(
												toDiffLineKey(row.target)
											)}
											isSelected={isDiffLineSelected(selection, row.target)}
											key={row.key}
											row={row}
											threads={lineThreads.byEndLine.get(
												toDiffLineKey(row.target)
											)}
										/>
									))
								: section.splitRows.map(row => (
										<DiffRow key={row.key} {...toRowProps(row)} />
									))}
						</div>
					))}
				</div>
			</div>
			{leftoverThreads.length > 0 && (
				<PullRequestOutdatedThreads
					number={number}
					permissions={permissions}
					slug={slug}
					threads={leftoverThreads}
					title="Comments on lines not shown"
					username={username}
				/>
			)}
		</div>
	)
}

type PullRequestDiffLine = PullRequestFileDiff['hunks'][number]['lines'][number]
type PullRequestDiffLineAnchor = NonNullable<PullRequestDiffLine['old']>

/** The anchor the composer posts, which the row holding the range's last line owns. */
function toSelectionAnchor(
	anchorComparison: PullRequestDiffAnchorComparison,
	selection: DiffLineSelection | undefined,
	line: PullRequestDiffLine | undefined,
	side: PullRequestThreadSide
): PullRequestThreadAnchor | undefined {
	const anchor = side === 'left' ? line?.old : line?.new

	if (!(line && anchor && selection) || selection.isSelecting) return undefined
	if (
		selection.side !== side ||
		selection.path !== anchor.path ||
		selection.endLine !== anchor.line
	)
		return undefined

	return {
		path: selection.path,
		side,
		startLine: selection.startLine,
		endLine: selection.endLine,
		anchorSha: anchor.sha,
		baseSha: anchorComparison.baseSha,
		headSha: anchorComparison.headSha,
		lineExcerpt: toThreadLineExcerpt(line.content),
	}
}

/** Room for the widest number this diff prints, with no lane held for the button. */
function toGutterWidth(diff: PullRequestFileDiff, totalLines?: number): string {
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

function toDiffLineKey(target: DiffLineTarget | undefined): string {
	return target ? `${target.side}:${target.line}` : ''
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

		const endKey = `${anchor.side}:${anchor.endLine}`

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
				commented.add(`${anchor.side}:${line}`)
	}

	return { byEndLine, commented }
}

/** Lines of the file no hunk shows, numbered on the right side. */
interface DiffGap {
	key: string
	startLine: number
	/** Absent while the file's length is unknown, which only the last gap can be. */
	endLine?: number
	/** `old − new` across the gap, so both gutters can be numbered from one fetch. */
	delta: number
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

const NO_SPLIT_ROWS: DiffRowModel[] = []
const NO_UNIFIED_ROWS: UnifiedRowModel[] = []

interface DiffRowModel {
	key: string
	left?: PullRequestDiffLine
	right?: PullRequestDiffLine
	leftTarget?: DiffLineTarget
	rightTarget?: DiffLineTarget
}

interface UnifiedRowModel {
	key: string
	line: PullRequestDiffLine
	/** The side this row is numbered and commented on. */
	side: PullRequestThreadSide
	target?: DiffLineTarget
}

function toSplitRows(section: DiffSection): DiffRowModel[] {
	return getSplitDiffRows(section.lines).map((row, index) => ({
		key: `${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}:${index}`,
		left: row.left,
		right: row.right,
		leftTarget: toDiffLineTarget(row.left?.old, 'left', section.leftRange),
		rightTarget: toDiffLineTarget(row.right?.new, 'right', section.rightRange),
	}))
}

/** Patch order, so a run's deletions read before the additions replacing them. */
function toUnifiedRows(section: DiffSection): UnifiedRowModel[] {
	return section.lines.map((line, index) => {
		const side: PullRequestThreadSide =
			line.kind === 'deletion' ? 'left' : 'right'

		return {
			key: `${line.old?.line ?? '-'}:${line.new?.line ?? '-'}:${index}`,
			line,
			side,
			target: toDiffLineTarget(
				side === 'left' ? line.old : line.new,
				side,
				side === 'left' ? section.leftRange : section.rightRange
			),
		}
	})
}

interface DiffRowContext {
	username: string
	slug: string
	number: string
	isWrapped: boolean
	permissions: PullRequestThreadPermissions
	onSelectLeft?: (action: DiffLineSelectionAction) => void
	onSelectRight?: (action: DiffLineSelectionAction) => void
	onComposerDone: () => void
}

interface DiffRowProps {
	row: DiffRowModel
	context: DiffRowContext
	leftThreads?: PullRequestThread[]
	rightThreads?: PullRequestThread[]
	leftAnchor?: PullRequestThreadAnchor
	rightAnchor?: PullRequestThreadAnchor
	isLeftCommented: boolean
	isRightCommented: boolean
	isLeftSelected: boolean
	isRightSelected: boolean
}

const SPLIT_GRID_CLASSES =
	'grid grid-cols-[var(--diff-gutter)_minmax(0,1fr)_var(--diff-gutter)_minmax(0,1fr)]'

const UNIFIED_GRID_CLASSES =
	'grid grid-cols-[var(--diff-gutter)_var(--diff-gutter)_minmax(0,1fr)]'

// A composer stretched across an unwrapped 4,000 px row is unreadable.
const THREAD_CELL_CLASSES = 'min-w-0 max-w-5xl'

function DiffRowView({
	context,
	isLeftCommented,
	isLeftSelected,
	isRightCommented,
	isRightSelected,
	leftAnchor,
	leftThreads,
	rightAnchor,
	rightThreads,
	row,
}: Readonly<DiffRowProps>) {
	const { number, onComposerDone, permissions, slug, username } = context
	const hasLeftThreadRow = Boolean(leftThreads || leftAnchor)
	const hasRightThreadRow = Boolean(rightThreads || rightAnchor)

	return (
		<>
			<div className={cn('group/diff-row', SPLIT_GRID_CLASSES)}>
				<DiffSide
					isCommented={isLeftCommented}
					isSelected={isLeftSelected}
					isWrapped={context.isWrapped}
					line={row.left}
					onSelect={context.onSelectLeft}
					side="left"
					target={row.leftTarget}
				/>
				<DiffSide
					isCommented={isRightCommented}
					isSelected={isRightSelected}
					isWrapped={context.isWrapped}
					line={row.right}
					onSelect={context.onSelectRight}
					side="right"
					target={row.rightTarget}
				/>
			</div>
			{(hasLeftThreadRow || hasRightThreadRow) && (
				// Discussion sits under the column it belongs to, as a split diff reads.
				<div className={SPLIT_GRID_CLASSES}>
					<div
						className={cn(
							'col-span-2 border-border border-r',
							THREAD_CELL_CLASSES
						)}
						data-thread-side="left"
					>
						{hasLeftThreadRow && (
							<PullRequestDiffThreadRow
								anchor={leftAnchor}
								number={number}
								onComposerDone={onComposerDone}
								permissions={permissions}
								slug={slug}
								threads={leftThreads ?? []}
								username={username}
							/>
						)}
					</div>
					<div
						className={cn('col-span-2', THREAD_CELL_CLASSES)}
						data-thread-side="right"
					>
						{hasRightThreadRow && (
							<PullRequestDiffThreadRow
								anchor={rightAnchor}
								number={number}
								onComposerDone={onComposerDone}
								permissions={permissions}
								slug={slug}
								threads={rightThreads ?? []}
								username={username}
							/>
						)}
					</div>
				</div>
			)}
		</>
	)
}

// One selection re-renders its whole file, which may run to thousands of rows.
const DiffRow = memo(DiffRowView)

interface UnifiedDiffRowProps {
	row: UnifiedRowModel
	context: DiffRowContext
	threads?: PullRequestThread[]
	anchor?: PullRequestThreadAnchor
	isCommented: boolean
	isSelected: boolean
}

function UnifiedDiffRowView({
	anchor,
	context,
	isCommented,
	isSelected,
	row,
	threads,
}: Readonly<UnifiedDiffRowProps>) {
	const { number, onComposerDone, permissions, slug, username } = context
	const { line, side, target } = row
	const tone: DiffLineTone = line.kind
	const onSelect =
		side === 'left' ? context.onSelectLeft : context.onSelectRight

	return (
		<>
			<div className={cn('group/diff-row', UNIFIED_GRID_CLASSES)}>
				<DiffGutter
					anchor={line.old}
					buttonClassName={
						side === 'left' ? UNIFIED_COMMENT_BUTTON_CLASSES : undefined
					}
					isCommented={isCommented && side === 'left'}
					isSelected={isSelected && side === 'left'}
					onSelect={side === 'left' ? onSelect : undefined}
					side="left"
					target={side === 'left' ? target : undefined}
					tone={line.old ? tone : 'context'}
				/>
				<DiffGutter
					anchor={line.new}
					buttonClassName={
						side === 'right' ? UNIFIED_COMMENT_BUTTON_CLASSES : undefined
					}
					isCommented={isCommented && side === 'right'}
					isSelected={isSelected && side === 'right'}
					onSelect={side === 'right' ? onSelect : undefined}
					side="right"
					target={side === 'right' ? target : undefined}
					tone={line.new ? tone : 'context'}
				/>
				<DiffCode
					isSelected={isSelected}
					isWrapped={context.isWrapped}
					line={line}
					side={side}
					tone={tone}
				/>
			</div>
			{(threads || anchor) && (
				<div className={UNIFIED_GRID_CLASSES}>
					<div
						className={cn('col-span-3', THREAD_CELL_CLASSES)}
						data-thread-side={side}
					>
						<PullRequestDiffThreadRow
							anchor={anchor}
							number={number}
							onComposerDone={onComposerDone}
							permissions={permissions}
							slug={slug}
							threads={threads ?? []}
							username={username}
						/>
					</div>
				</div>
			)}
		</>
	)
}

const UnifiedDiffRow = memo(UnifiedDiffRowView)

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

type DiffLineTone = 'addition' | 'context' | 'deletion' | 'empty'

const DIFF_GUTTER_TONE_CLASSES: Record<DiffLineTone, string> = {
	addition: 'bg-diff-add-gutter',
	context: '',
	deletion: 'bg-diff-del-gutter',
	empty: 'diff-empty-cell',
}

const DIFF_CELL_TONE_CLASSES: Record<DiffLineTone, string> = {
	addition: 'bg-diff-add-line',
	context: 'group-hover/diff-row:bg-diff-row-hover',
	deletion: 'bg-diff-del-line',
	empty: 'diff-empty-cell',
}

const DIFF_SIGN_CLASSES: Partial<Record<DiffLineTone, string>> = {
	addition: 'text-diff-add-marker',
	deletion: 'text-diff-del-marker',
}

const DIFF_LINE_PREFIXES: Partial<Record<DiffLineTone, string>> = {
	addition: '+',
	deletion: '−',
}

const PRIMARY_BUTTON_HELD = 1

const DIFF_SELECTED_CLASSES = 'bg-diff-select/45'
const DIFF_SELECTED_EDGE_CLASSES = 'border-l-2 border-l-diff-select-edge'
/** Carried by the gutter alone, so an added or removed line keeps its colour. */
const DIFF_COMMENTED_CLASSES =
	'border-l-2 border-l-diff-comment-edge bg-diff-comment-tint/55'

// Only the hovered side offers its comment button, so two-sided rows stay unambiguous.
const DIFF_COMMENT_BUTTON_CLASSES: Record<PullRequestThreadSide, string> = {
	left: 'group-has-[[data-side=left]:hover]/diff-row:opacity-100',
	right: 'group-has-[[data-side=right]:hover]/diff-row:opacity-100',
}

// A unified row has one side, so any hover on it is unambiguous.
const UNIFIED_COMMENT_BUTTON_CLASSES = 'group-hover/diff-row:opacity-100'

interface DiffGutterProps {
	anchor?: PullRequestDiffLineAnchor
	tone: DiffLineTone
	side: PullRequestThreadSide
	target?: DiffLineTarget
	isCommented: boolean
	isSelected: boolean
	buttonClassName?: string
	onSelect?: (action: DiffLineSelectionAction) => void
}

function DiffGutter({
	anchor,
	buttonClassName,
	isCommented,
	isSelected,
	onSelect,
	side,
	target,
	tone,
}: Readonly<DiffGutterProps>) {
	return (
		// The whole gutter widens a drag, so the range does not stop at the button.
		<span
			className={cn(
				'relative select-none py-0 pr-2 pl-3 text-right text-diff-gutter-fg tabular-nums',
				DIFF_GUTTER_TONE_CLASSES[tone],
				isCommented && DIFF_COMMENTED_CLASSES,
				isSelected && [DIFF_SELECTED_CLASSES, DIFF_SELECTED_EDGE_CLASSES]
			)}
			data-commented={isCommented || undefined}
			data-selected={isSelected || undefined}
			data-side={side}
			onPointerEnter={event => {
				if (event.buttons === PRIMARY_BUTTON_HELD && target)
					onSelect?.({ type: 'extend', target })
			}}
		>
			{onSelect && anchor && target && (
				<button
					aria-label={`Comment on ${side === 'left' ? 'original' : 'updated'} line ${anchor.line}`}
					className={cn(
						'absolute top-1/2 right-0.5 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm bg-primary text-primary-foreground opacity-0 shadow-sm transition-opacity duration-[90ms] ease-out focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
						buttonClassName ?? DIFF_COMMENT_BUTTON_CLASSES[side]
					)}
					onClick={event =>
						onSelect({
							type: event.shiftKey ? 'extend' : 'select',
							target,
						})
					}
					// Shift only ever extends from the click, so a press cannot drop the range first.
					onPointerDown={event => {
						if (!event.shiftKey) onSelect({ type: 'begin', target })
					}}
					type="button"
				>
					<Plus aria-hidden className="size-3" />
				</button>
			)}
			{anchor?.line}
		</span>
	)
}

interface DiffCodeProps {
	line?: PullRequestDiffLine
	tone: DiffLineTone
	side: PullRequestThreadSide
	isSelected: boolean
	isWrapped: boolean
	hasBorder?: boolean
}

function DiffCode({
	hasBorder,
	isSelected,
	isWrapped,
	line,
	side,
	tone,
}: Readonly<DiffCodeProps>) {
	const sign = DIFF_LINE_PREFIXES[tone]

	return (
		<span
			className={cn(
				'relative py-0 pr-3 text-diff-code-fg',
				isWrapped
					? 'whitespace-pre-wrap break-words pl-[calc(var(--diff-code-pad)+1.5ch)] [text-indent:-1.5ch]'
					: 'whitespace-pre pl-[var(--diff-code-pad)]',
				hasBorder && 'border-border border-r',
				DIFF_CELL_TONE_CLASSES[tone],
				isSelected && DIFF_SELECTED_CLASSES
			)}
			data-empty={tone === 'empty' || undefined}
			data-kind={line?.kind}
			data-side={side}
		>
			{sign && (
				<span
					aria-hidden
					className={cn(
						'absolute left-1.5 w-3 select-none text-center [text-indent:0]',
						DIFF_SIGN_CLASSES[tone]
					)}
				>
					{sign}
				</span>
			)}
			{line && <HighlightedDiffContent line={line} />}
		</span>
	)
}

interface DiffSideProps {
	line?: PullRequestDiffLine
	side: PullRequestThreadSide
	target?: DiffLineTarget
	isCommented: boolean
	isSelected: boolean
	isWrapped: boolean
	onSelect?: (action: DiffLineSelectionAction) => void
}

function DiffSide({
	isCommented,
	isSelected,
	isWrapped,
	line,
	onSelect,
	side,
	target,
}: Readonly<DiffSideProps>) {
	const tone: DiffLineTone = line?.kind ?? 'empty'
	const anchor = side === 'left' ? line?.old : line?.new

	return (
		<>
			<DiffGutter
				anchor={anchor}
				isCommented={isCommented}
				isSelected={isSelected}
				onSelect={onSelect}
				side={side}
				target={target}
				tone={tone}
			/>
			<DiffCode
				hasBorder={side === 'left'}
				isSelected={isSelected}
				isWrapped={isWrapped}
				line={line}
				side={side}
				tone={tone}
			/>
		</>
	)
}

const EXPAND_STEP = 20
// Beyond this a gap is worth opening in steps rather than all at once.
const EXPAND_ALL_LIMIT = 40

interface DiffSeparatorRowProps {
	header?: string
	gap?: DiffGap
	expansion: PullRequestFileExpansion
}

function DiffSeparatorRow({
	expansion,
	gap,
	header,
}: Readonly<DiffSeparatorRowProps>) {
	const key = gap?.key ?? ''
	const startLine = gap?.startLine ?? 0
	const endLine = gap?.endLine
	const size = endLine === undefined ? undefined : endLine - startLine + 1
	const isPending = expansion.pendingGapKey === key
	const hasFailed = expansion.failed?.gapKey === key
	const expand = (request: Omit<PullRequestFileExpansionRequest, 'gapKey'>) =>
		expansion.expand({ ...request, gapKey: key })

	return (
		<div className="flex h-[22px] items-center gap-2 bg-diff-hunk pr-3 pl-1 text-diff-hunk-fg text-xs">
			<span className="flex w-9 shrink-0 items-center justify-start gap-px text-diff-hunk-action">
				{isPending && (
					<Loader2 aria-label="Loading lines" className="size-3 animate-spin" />
				)}
				{gap && !isPending && (
					<>
						{endLine !== undefined &&
							size !== undefined &&
							size > EXPAND_STEP && (
								<ExpandButton
									label={`Show ${EXPAND_STEP} lines above`}
									onClick={() =>
										expand({
											startLine: Math.max(startLine, endLine - EXPAND_STEP + 1),
											endLine,
										})
									}
								>
									<ChevronUp aria-hidden className="size-3" />
								</ExpandButton>
							)}
						{(size === undefined || size > EXPAND_STEP) && (
							<ExpandButton
								label={`Show ${EXPAND_STEP} lines below`}
								onClick={() =>
									expand({
										startLine,
										endLine: Math.min(
											endLine ?? Number.POSITIVE_INFINITY,
											startLine + EXPAND_STEP - 1
										),
									})
								}
							>
								<ChevronDown aria-hidden className="size-3" />
							</ExpandButton>
						)}
						{size !== undefined && size <= EXPAND_ALL_LIMIT && (
							<ExpandButton
								label={`Show all ${size} hidden lines`}
								onClick={() =>
									expand({ startLine, endLine: endLine ?? startLine })
								}
							>
								<ChevronsUpDown aria-hidden className="size-3" />
							</ExpandButton>
						)}
					</>
				)}
			</span>
			{header && <span className="truncate">{header}</span>}
			{hasFailed && (
				<span className="text-destructive" role="alert">
					{isPullRequestStaleComparisonError(expansion.error) ? (
						PULL_REQUEST_STALE_COMPARISON_MESSAGE
					) : (
						<>
							Those lines could not be loaded.{' '}
							<button
								className="cursor-pointer underline"
								onClick={expansion.retry}
								type="button"
							>
								Retry
							</button>
						</>
					)}
				</span>
			)}
		</div>
	)
}

function ExpandButton({
	children,
	label,
	onClick,
}: Readonly<{ children: ReactNode; label: string; onClick: () => void }>) {
	return (
		<button
			aria-label={label}
			className="flex size-4 cursor-pointer items-center justify-center rounded-xs hover:bg-diff-select focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onClick}
			title={label}
			type="button"
		>
			{children}
		</button>
	)
}

function HighlightedDiffContent({
	line,
}: Readonly<{ line: PullRequestDiffLine }>) {
	if (!line.html) return line.content

	return <span dangerouslySetInnerHTML={{ __html: line.html }} data-shiki="" />
}
