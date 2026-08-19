import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadSide,
} from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Plus } from 'lucide-react'
import { type CSSProperties, memo, useCallback, useMemo } from 'react'
import {
	type DiffLineHunkRange,
	type DiffLineSelection,
	type DiffLineSelectionAction,
	type DiffLineTarget,
	isDiffLineSelected,
} from '../helpers/diff-line-selection'
import {
	getInlineThreadsForLine,
	getLeftoverInlineThreads,
	isLineInsideInlineThread,
	toThreadLineExcerpt,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
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
	permissions,
	threads,
}: Readonly<PullRequestFileDiffViewProps>) {
	const diffQuery = usePullRequestFileDiffQuery(
		{ expectedBaseSha, expectedHeadSha, username, slug, number, path },
		true
	)

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
			number={number}
			permissions={permissions}
			slug={slug}
			threads={threads}
			username={username}
		/>
	)
}

// Every mounted file would re-render on any files-view state change otherwise.
export const PullRequestFileDiffView = memo(FileDiffView)

interface FileDiffProps {
	diff: PullRequestFileDiff
	anchorComparison: PullRequestDiffAnchorComparison
	anchorableSides: readonly PullRequestThreadSide[]
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
	threads,
	permissions,
	username,
	slug,
	number,
}: Readonly<FileDiffProps>) {
	const [selection, dispatchSelection] = usePullRequestDiffSelection(diff.file)
	const hunks = useMemo(() => toDiffHunks(diff), [diff])
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
			...getLeftoverInlineThreads(placeableThreads, diff),
			...threads.filter(thread => !placeableThreads.includes(thread)),
		],
		[diff, placeableThreads, threads]
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
				className="font-mono text-xs leading-5 [font-feature-settings:'liga'_0,'calt'_0] [font-variant-ligatures:none]"
				data-diff-code
				style={{ '--diff-gutter': toGutterWidth(diff) } as CSSProperties}
			>
				{hunks.map(hunk => (
					<div key={hunk.header}>
						<div className="bg-secondary/60 px-2 py-1 text-muted-foreground">
							{hunk.header}
						</div>
						{hunk.rows.map(row => (
							<DiffRow
								context={rowContext}
								isLeftCommented={lineThreads.commented.has(
									toDiffLineKey(row.leftTarget)
								)}
								isLeftSelected={isDiffLineSelected(selection, row.leftTarget)}
								isRightCommented={lineThreads.commented.has(
									toDiffLineKey(row.rightTarget)
								)}
								isRightSelected={isDiffLineSelected(selection, row.rightTarget)}
								key={row.key}
								leftAnchor={toSelectionAnchor(
									anchorComparison,
									selection,
									row.left,
									'left'
								)}
								leftThreads={lineThreads.byEndLine.get(
									toDiffLineKey(row.leftTarget)
								)}
								rightAnchor={toSelectionAnchor(
									anchorComparison,
									selection,
									row.right,
									'right'
								)}
								rightThreads={lineThreads.byEndLine.get(
									toDiffLineKey(row.rightTarget)
								)}
								row={row}
							/>
						))}
					</div>
				))}
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

/** Room for the widest number this diff prints, plus the comment button's lane. */
function toGutterWidth(diff: PullRequestFileDiff): string {
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
		1
	)

	return `calc(${widest}ch + 2rem)`
}

/** The line numbers a hunk renders on one side, absent when it renders none. */
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

interface DiffHunk {
	header: string
	rows: DiffRowModel[]
}

interface DiffRowModel {
	key: string
	left?: PullRequestDiffLine
	right?: PullRequestDiffLine
	leftTarget?: DiffLineTarget
	rightTarget?: DiffLineTarget
}

/** Splitting a diff into rows costs more than rendering them, so it runs once. */
function toDiffHunks(diff: PullRequestFileDiff): DiffHunk[] {
	return diff.hunks.map(hunk => {
		const leftRange = toHunkRange(hunk.lines, 'left')
		const rightRange = toHunkRange(hunk.lines, 'right')

		return {
			header: hunk.header,
			rows: getSplitDiffRows(hunk.lines).map((row, index) => ({
				key: `${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}:${index}`,
				left: row.left,
				right: row.right,
				leftTarget: toDiffLineTarget(row.left?.old, 'left', leftRange),
				rightTarget: toDiffLineTarget(row.right?.new, 'right', rightRange),
			})),
		}
	})
}

interface DiffRowContext {
	username: string
	slug: string
	number: string
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
	'grid grid-cols-[var(--diff-gutter)_1.25rem_minmax(0,1fr)_var(--diff-gutter)_1.25rem_minmax(0,1fr)]'

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
					line={row.left}
					onSelect={context.onSelectLeft}
					side="left"
					target={row.leftTarget}
				/>
				<DiffSide
					isCommented={isRightCommented}
					isSelected={isRightSelected}
					line={row.right}
					onSelect={context.onSelectRight}
					side="right"
					target={row.rightTarget}
				/>
			</div>
			{(hasLeftThreadRow || hasRightThreadRow) && (
				// Discussion sits under the column it belongs to, as a split diff reads.
				<div
					className={cn(
						SPLIT_GRID_CLASSES,
						'border-border border-y bg-muted/20'
					)}
				>
					<div
						className="col-span-3 min-w-0 border-border border-r"
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
					<div className="col-span-3 min-w-0" data-thread-side="right">
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
	addition: 'bg-emerald-950/50',
	context: '',
	deletion: 'bg-red-950/50',
	empty: 'bg-muted/20',
}

const DIFF_CELL_TONE_CLASSES: Record<DiffLineTone, string> = {
	addition: 'bg-emerald-950/35',
	context: '',
	deletion: 'bg-red-950/35',
	empty: 'bg-muted/20',
}

const DIFF_LINE_PREFIXES: Record<DiffLineTone, string> = {
	addition: '+',
	context: ' ',
	deletion: '−',
	empty: '',
}

const PRIMARY_BUTTON_HELD = 1

const DIFF_SELECTED_CLASSES = 'bg-primary/20'
/** A left rule rather than a tint, so an added or removed line keeps its colour. */
const DIFF_COMMENTED_CLASSES = 'border-l-2 border-l-amber-400/60'

interface DiffSideProps {
	line?: PullRequestDiffLine
	side: PullRequestThreadSide
	target?: DiffLineTarget
	isCommented: boolean
	isSelected: boolean
	onSelect?: (action: DiffLineSelectionAction) => void
}

function DiffSide({
	isCommented,
	isSelected,
	line,
	onSelect,
	side,
	target,
}: Readonly<DiffSideProps>) {
	const tone: DiffLineTone = line?.kind ?? 'empty'
	const anchor = side === 'left' ? line?.old : line?.new

	return (
		<div
			className="contents"
			data-commented={isCommented || undefined}
			data-empty={tone === 'empty' || undefined}
			data-selected={isSelected || undefined}
			data-side={side}
		>
			{/* The whole gutter widens a drag, so the range does not stop at the button. */}
			<span
				className={cn(
					'relative select-none border-border border-r py-0 pr-2 pl-6 text-right text-muted-foreground',
					DIFF_GUTTER_TONE_CLASSES[tone],
					isCommented && DIFF_COMMENTED_CLASSES,
					isSelected && DIFF_SELECTED_CLASSES
				)}
				onPointerEnter={event => {
					if (event.buttons === PRIMARY_BUTTON_HELD && target)
						onSelect?.({ type: 'extend', target })
				}}
			>
				{onSelect && line && anchor && target && (
					<button
						aria-label={`Comment on ${side === 'left' ? 'original' : 'updated'} line ${anchor.line}`}
						className="absolute top-1/2 left-0.5 flex size-[18px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm bg-primary text-primary-foreground opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/diff-row:opacity-100"
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
			<span
				className={cn(
					'select-none py-0 text-center text-muted-foreground',
					DIFF_CELL_TONE_CLASSES[tone],
					isSelected && DIFF_SELECTED_CLASSES
				)}
			>
				{DIFF_LINE_PREFIXES[tone]}
			</span>
			<span
				className={cn(
					'whitespace-pre-wrap py-0 pr-3 [overflow-wrap:anywhere]',
					side === 'left' && 'border-border border-r',
					DIFF_CELL_TONE_CLASSES[tone],
					isSelected && DIFF_SELECTED_CLASSES
				)}
				data-kind={line?.kind}
				data-side={side}
			>
				{line && <HighlightedDiffContent line={line} />}
			</span>
		</div>
	)
}

function HighlightedDiffContent({
	line,
}: Readonly<{ line: PullRequestDiffLine }>) {
	return (
		<>
			{line.lightHtml ? (
				<span
					className="dark:hidden"
					dangerouslySetInnerHTML={{ __html: line.lightHtml }}
				/>
			) : (
				<span className="dark:hidden">{line.content}</span>
			)}
			{line.darkHtml ? (
				<span
					className="hidden dark:inline"
					dangerouslySetInnerHTML={{ __html: line.darkHtml }}
				/>
			) : (
				<span className="hidden dark:inline">{line.content}</span>
			)}
		</>
	)
}
