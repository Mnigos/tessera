import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadSide,
} from '@repo/contracts'
import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import {
	defaultRangeExtractor,
	useWindowVirtualizer,
} from '@tanstack/react-virtual'
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
	useRef,
	useState,
} from 'react'
import {
	type DiffLineSelection,
	type DiffLineSelectionAction,
	type DiffLineTarget,
	isDiffLineSelected,
} from '../helpers/diff-line-selection'
import { isPullRequestStaleComparisonError } from '../helpers/get-pull-request-error-message'
import {
	buildDiffRows,
	type DiffGap,
	type DiffRow,
	type DiffSplitRow,
	type DiffThreadRow,
	type DiffUnifiedRow,
	type PullRequestDiffLine,
	toDiffLineKey,
} from '../helpers/pull-request-diff-rows'
import { toThreadLineExcerpt } from '../helpers/pull-request-inline-threads'
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
	const composerPath = selection?.isSelecting ? undefined : selection?.path
	const composerSide = selection?.isSelecting ? undefined : selection?.side
	const composerLine = selection?.isSelecting ? undefined : selection?.endLine
	const { commentedKeys, gutterWidth, leftoverThreads, rows } = useMemo(
		() =>
			buildDiffRows({
				anchorableSides,
				composer:
					composerPath && composerSide && composerLine
						? { path: composerPath, side: composerSide, line: composerLine }
						: undefined,
				diff,
				expansion: {
					lines: expansion.lines,
					totalLines: expansion.totalLines,
				},
				threads,
				view,
			}),
		[
			anchorableSides,
			composerLine,
			composerPath,
			composerSide,
			diff,
			expansion.lines,
			expansion.totalLines,
			threads,
			view,
		]
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
			view,
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
			view,
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
				className={cn(
					"font-mono text-[13px] leading-[22px] [font-feature-settings:'liga'_0,'calt'_0] [font-variant-ligatures:none] [tab-size:2]",
					!isWrapped && 'overflow-x-auto'
				)}
				data-diff-code
				style={
					{
						'--diff-gutter': gutterWidth,
						'--diff-code-pad': '1.25rem',
					} as CSSProperties
				}
			>
				{/* Unwrapped code sets the width, so every row scrolls as one block. */}
				<div className={cn(!isWrapped && 'w-max min-w-full')}>
					<DiffRowList
						anchorComparison={anchorComparison}
						commentedKeys={commentedKeys}
						context={rowContext}
						expansion={expansion}
						rows={rows}
						selection={selection}
					/>
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

const DIFF_ROW_HEIGHT = 22
const DIFF_THREAD_ROW_ESTIMATE = 140
const DIFF_ROW_OVERSCAN = 12
const DIFF_WINDOW_THRESHOLD = 500

type DiffRowRenderer = (row: DiffRow) => ReactNode

interface DiffRowListProps {
	rows: DiffRow[]
	commentedKeys: ReadonlySet<string>
	selection: DiffLineSelection | undefined
	anchorComparison: PullRequestDiffAnchorComparison
	context: DiffRowContext
	expansion: PullRequestFileExpansion
}

function DiffRowList({
	rows,
	commentedKeys,
	selection,
	anchorComparison,
	context,
	expansion,
}: Readonly<DiffRowListProps>) {
	// Windowing is one-way: crossing back would remount every row under a draft.
	const [isWindowed, setIsWindowed] = useState(
		rows.length >= DIFF_WINDOW_THRESHOLD
	)

	if (!isWindowed && rows.length >= DIFF_WINDOW_THRESHOLD) setIsWindowed(true)

	const renderRow: DiffRowRenderer = row => (
		<DiffRowItem
			anchorComparison={anchorComparison}
			commentedKeys={commentedKeys}
			context={context}
			expansion={expansion}
			key={row.key}
			row={row}
			selection={selection}
		/>
	)

	if (!isWindowed) return <>{rows.map(row => renderRow(row))}</>

	return (
		<DiffRowsWindow
			isWrapped={context.isWrapped}
			renderRow={renderRow}
			rows={rows}
		/>
	)
}

function needsMeasurement(row: DiffRow, isWrapped: boolean) {
	if (row.kind === 'thread') return true

	return isWrapped && row.kind !== 'separator'
}

function hasOpenComposer(row: DiffRow) {
	return (
		row.kind === 'thread' &&
		Boolean(row.left?.hasComposer || row.right?.hasComposer)
	)
}

interface DiffRowsWindowProps {
	rows: DiffRow[]
	isWrapped: boolean
	renderRow: DiffRowRenderer
}

function DiffRowsWindow({
	rows,
	isWrapped,
	renderRow,
}: Readonly<DiffRowsWindowProps>) {
	// The virtualizer mutates one stable instance, which the compiler would cache away.
	'use no memo'

	const listRef = useRef<HTMLDivElement | null>(null)
	const [scrollMargin, setScrollMargin] = useState(0)
	const [focusedRowKey, setFocusedRowKey] = useState<string>()
	const attachList = useCallback((node: HTMLDivElement | null) => {
		listRef.current = node

		if (node) setScrollMargin(node.getBoundingClientRect().top + window.scrollY)
	}, [])
	// A row holding a draft or the caret must outlive scrolling far past it.
	const pinnedIndexes = useMemo(() => {
		const pinned: number[] = []

		rows.forEach((row, index) => {
			if (row.key === focusedRowKey || hasOpenComposer(row)) pinned.push(index)
		})

		return pinned
	}, [focusedRowKey, rows])
	const virtualizer = useWindowVirtualizer<HTMLDivElement>({
		count: rows.length,
		estimateSize: index =>
			rows[index]?.kind === 'thread'
				? DIFF_THREAD_ROW_ESTIMATE
				: DIFF_ROW_HEIGHT,
		getItemKey: index => rows[index]?.key ?? index,
		// A file above can grow or collapse without ever re-rendering this one.
		onChange: () => {
			const node = listRef.current

			if (!node) return

			const margin = node.getBoundingClientRect().top + window.scrollY

			setScrollMargin(current => (current === margin ? current : margin))
		},
		overscan: DIFF_ROW_OVERSCAN,
		rangeExtractor: range => {
			const visible = defaultRangeExtractor(range)

			if (pinnedIndexes.length === 0) return visible

			return [...new Set([...visible, ...pinnedIndexes])].sort((a, b) => a - b)
		},
		scrollMargin,
	})
	const items = virtualizer.getVirtualItems()
	const { range } = virtualizer
	const flowStart = range
		? Math.max(range.startIndex - DIFF_ROW_OVERSCAN, 0)
		: 0
	const flowEnd = range
		? Math.min(range.endIndex + DIFF_ROW_OVERSCAN, rows.length - 1)
		: -1
	const flowItems = items.filter(
		item => item.index >= flowStart && item.index <= flowEnd
	)
	const first = flowItems[0]
	const last = flowItems.at(-1)
	const totalSize = virtualizer.getTotalSize()

	return (
		<div
			className="relative"
			onBlurCapture={event => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setFocusedRowKey(undefined)
			}}
			onFocusCapture={event => {
				const holder = event.target.closest('[data-index]')
				const index = holder ? Number(holder.getAttribute('data-index')) : -1

				setFocusedRowKey(rows[index]?.key)
			}}
			ref={attachList}
		>
			<div style={{ height: first ? first.start - scrollMargin : 0 }} />
			{items.map(item => {
				const row = rows[item.index]

				if (!row) return null

				const isPinned = item.index < flowStart || item.index > flowEnd

				return (
					<div
						className={isPinned ? 'absolute inset-x-0' : undefined}
						data-index={item.index}
						key={item.key}
						ref={
							needsMeasurement(row, isWrapped)
								? virtualizer.measureElement
								: undefined
						}
						style={isPinned ? { top: item.start - scrollMargin } : undefined}
					>
						{renderRow(row)}
					</div>
				)
			})}
			<div
				style={{
					height: last ? totalSize - (last.end - scrollMargin) : totalSize,
				}}
			/>
		</div>
	)
}

interface DiffRowItemProps {
	row: DiffRow
	commentedKeys: ReadonlySet<string>
	selection: DiffLineSelection | undefined
	anchorComparison: PullRequestDiffAnchorComparison
	context: DiffRowContext
	expansion: PullRequestFileExpansion
}

function DiffRowItem({
	row,
	commentedKeys,
	selection,
	anchorComparison,
	context,
	expansion,
}: Readonly<DiffRowItemProps>) {
	if (row.kind === 'separator')
		return (
			<DiffSeparatorRow
				expansion={expansion}
				gap={row.gap}
				header={row.header}
			/>
		)

	if (row.kind === 'thread')
		return (
			<DiffThreadRowView
				context={context}
				leftAnchor={toSelectionAnchor(
					anchorComparison,
					selection,
					row.left?.line,
					'left'
				)}
				rightAnchor={toSelectionAnchor(
					anchorComparison,
					selection,
					row.right?.line,
					'right'
				)}
				row={row}
			/>
		)

	if (row.kind === 'unified')
		return (
			<UnifiedDiffRow
				context={context}
				isCommented={isTargetCommented(commentedKeys, row.target)}
				isSelected={isDiffLineSelected(selection, row.target)}
				row={row}
			/>
		)

	return (
		<SplitDiffRow
			context={context}
			isLeftCommented={isTargetCommented(commentedKeys, row.leftTarget)}
			isLeftSelected={isDiffLineSelected(selection, row.leftTarget)}
			isRightCommented={isTargetCommented(commentedKeys, row.rightTarget)}
			isRightSelected={isDiffLineSelected(selection, row.rightTarget)}
			row={row}
		/>
	)
}

function isTargetCommented(
	commentedKeys: ReadonlySet<string>,
	target: DiffLineTarget | undefined
) {
	return target
		? commentedKeys.has(toDiffLineKey(target.side, target.line))
		: false
}

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

interface DiffRowContext {
	username: string
	slug: string
	number: string
	isWrapped: boolean
	view: PullRequestDiffView
	permissions: PullRequestThreadPermissions
	onSelectLeft?: (action: DiffLineSelectionAction) => void
	onSelectRight?: (action: DiffLineSelectionAction) => void
	onComposerDone: () => void
}

interface SplitDiffRowProps {
	row: DiffSplitRow
	context: DiffRowContext
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

function SplitDiffRowView({
	context,
	isLeftCommented,
	isLeftSelected,
	isRightCommented,
	isRightSelected,
	row,
}: Readonly<SplitDiffRowProps>) {
	return (
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
	)
}

// One selection re-renders its whole file, which may run to thousands of rows.
const SplitDiffRow = memo(SplitDiffRowView)

interface DiffThreadRowProps {
	row: DiffThreadRow
	context: DiffRowContext
	leftAnchor?: PullRequestThreadAnchor
	rightAnchor?: PullRequestThreadAnchor
}

function DiffThreadRowView({
	context,
	leftAnchor,
	rightAnchor,
	row,
}: Readonly<DiffThreadRowProps>) {
	const { number, onComposerDone, permissions, slug, username, view } = context

	if (view === 'unified') {
		const slot = row.left ?? row.right

		return (
			<div className={UNIFIED_GRID_CLASSES}>
				<div
					className={cn('col-span-3', THREAD_CELL_CLASSES)}
					data-thread-side={slot?.side}
				>
					<PullRequestDiffThreadRow
						anchor={row.left ? leftAnchor : rightAnchor}
						number={number}
						onComposerDone={onComposerDone}
						permissions={permissions}
						slug={slug}
						threads={slot?.threads ?? []}
						username={username}
					/>
				</div>
			</div>
		)
	}

	return (
		// Discussion sits under the column it belongs to, as a split diff reads.
		<div className={SPLIT_GRID_CLASSES}>
			<div
				className={cn('col-span-2 border-border border-r', THREAD_CELL_CLASSES)}
				data-thread-side="left"
			>
				{row.left && (
					<PullRequestDiffThreadRow
						anchor={leftAnchor}
						number={number}
						onComposerDone={onComposerDone}
						permissions={permissions}
						slug={slug}
						threads={row.left.threads}
						username={username}
					/>
				)}
			</div>
			<div
				className={cn('col-span-2', THREAD_CELL_CLASSES)}
				data-thread-side="right"
			>
				{row.right && (
					<PullRequestDiffThreadRow
						anchor={rightAnchor}
						number={number}
						onComposerDone={onComposerDone}
						permissions={permissions}
						slug={slug}
						threads={row.right.threads}
						username={username}
					/>
				)}
			</div>
		</div>
	)
}

interface UnifiedDiffRowProps {
	row: DiffUnifiedRow
	context: DiffRowContext
	isCommented: boolean
	isSelected: boolean
}

function UnifiedDiffRowView({
	context,
	isCommented,
	isSelected,
	row,
}: Readonly<UnifiedDiffRowProps>) {
	const { line, side, target } = row
	const tone: DiffLineTone = line.kind
	const onSelect =
		side === 'left' ? context.onSelectLeft : context.onSelectRight

	return (
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
	)
}

const UnifiedDiffRow = memo(UnifiedDiffRowView)

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
	anchor?: NonNullable<PullRequestDiffLine['old']>
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
