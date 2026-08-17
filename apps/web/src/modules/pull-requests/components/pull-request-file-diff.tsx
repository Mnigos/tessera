import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadSide,
} from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Plus } from 'lucide-react'
import type { CSSProperties } from 'react'
import {
	type DiffLineHunkRange,
	type DiffLineSelection,
	type DiffLineSelectionAction,
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

export function PullRequestFileDiffView({
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
	const [selection, dispatchSelection] = usePullRequestDiffSelection()

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

	const placeableThreads = threads.filter(thread =>
		thread.anchor ? anchorableSides.includes(thread.anchor.side) : false
	)
	// A thread this diff cannot place is listed below rather than dropped: the
	// side it was left on is numbered against a base this diff never had.
	const leftoverThreads = [
		...getLeftoverInlineThreads(placeableThreads, diff),
		...threads.filter(thread => !placeableThreads.includes(thread)),
	]
	const threading: PullRequestDiffThreading = {
		anchorableSides,
		anchorComparison,
		number,
		onSelect: permissions.canComment ? dispatchSelection : undefined,
		permissions,
		selection,
		slug,
		threads: placeableThreads,
		username,
	}

	return (
		// biome-ignore lint/a11y: Escape only shortcuts the composer's own Cancel button
		<div
			className="bg-background"
			onKeyDown={event => {
				if (event.key === 'Escape') dispatchSelection({ type: 'clear' })
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
				{diff.hunks.map(hunk => {
					const hunkRanges = {
						left: toHunkRange(hunk.lines, 'left'),
						right: toHunkRange(hunk.lines, 'right'),
					}

					return (
						<div key={hunk.header}>
							<div className="bg-secondary/60 px-2 py-1 text-muted-foreground">
								{hunk.header}
							</div>
							{getSplitDiffRows(hunk.lines).map((row, index) => (
								<DiffRow
									hunkRanges={hunkRanges}
									key={`${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}:${index}`}
									row={row}
									threading={threading}
								/>
							))}
						</div>
					)
				})}
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

interface PullRequestDiffThreading {
	username: string
	slug: string
	number: string
	permissions: PullRequestThreadPermissions
	threads: PullRequestThread[]
	anchorComparison: PullRequestDiffAnchorComparison
	anchorableSides: readonly PullRequestThreadSide[]
	selection?: DiffLineSelection
	onSelect?: (action: DiffLineSelectionAction) => void
}

/** The anchor the composer posts, which the row holding the range's last line owns. */
function toSelectionAnchor(
	{ anchorComparison, selection }: PullRequestDiffThreading,
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

interface DiffRowProps {
	row: SplitDiffRow
	hunkRanges: { left?: DiffLineHunkRange; right?: DiffLineHunkRange }
	threading: PullRequestDiffThreading
}

function DiffRow({ hunkRanges, row, threading }: Readonly<DiffRowProps>) {
	const {
		anchorableSides,
		number,
		onSelect,
		permissions,
		selection,
		slug,
		threads,
		username,
	} = threading
	const leftLine = row.left?.old?.line
	const rightLine = row.right?.new?.line
	const leftThreads = leftLine
		? getInlineThreadsForLine(threads, 'left', leftLine)
		: []
	const rightThreads = rightLine
		? getInlineThreadsForLine(threads, 'right', rightLine)
		: []
	const leftAnchor = toSelectionAnchor(threading, row.left, 'left')
	const rightAnchor = toSelectionAnchor(threading, row.right, 'right')

	return (
		<>
			<div className="group/diff-row grid grid-cols-[var(--diff-gutter)_1.25rem_minmax(0,1fr)_var(--diff-gutter)_1.25rem_minmax(0,1fr)]">
				<DiffSide
					hunkRange={hunkRanges.left}
					line={row.left}
					onSelect={anchorableSides.includes('left') ? onSelect : undefined}
					selection={selection}
					side="left"
					threads={threads}
				/>
				<DiffSide
					hunkRange={hunkRanges.right}
					line={row.right}
					onSelect={anchorableSides.includes('right') ? onSelect : undefined}
					selection={selection}
					side="right"
					threads={threads}
				/>
			</div>
			{(leftThreads.length > 0 || leftAnchor) && (
				<PullRequestDiffThreadRow
					anchor={leftAnchor}
					number={number}
					onComposerDone={() => onSelect?.({ type: 'clear' })}
					permissions={permissions}
					slug={slug}
					threads={leftThreads}
					username={username}
				/>
			)}
			{(rightThreads.length > 0 || rightAnchor) && (
				<PullRequestDiffThreadRow
					anchor={rightAnchor}
					number={number}
					onComposerDone={() => onSelect?.({ type: 'clear' })}
					permissions={permissions}
					slug={slug}
					threads={rightThreads}
					username={username}
				/>
			)}
		</>
	)
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
	threads: PullRequestThread[]
	hunkRange?: DiffLineHunkRange
	selection?: DiffLineSelection
	onSelect?: (action: DiffLineSelectionAction) => void
}

function DiffSide({
	hunkRange,
	line,
	onSelect,
	selection,
	side,
	threads,
}: Readonly<DiffSideProps>) {
	const tone: DiffLineTone = line?.kind ?? 'empty'
	const anchor = side === 'left' ? line?.old : line?.new
	const target = anchor &&
		hunkRange && { hunk: hunkRange, line: anchor.line, path: anchor.path, side }
	const isSelected = isDiffLineSelected(selection, target)
	const isCommented = anchor
		? isLineInsideInlineThread(threads, side, anchor.line)
		: false

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
