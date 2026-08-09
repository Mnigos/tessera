import type {
	PullRequestFileDiff,
	PullRequestThread,
	PullRequestThreadAnchor,
	PullRequestThreadSide,
} from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import {
	getInlineThreadsForLine,
	getLeftoverInlineThreads,
	toThreadLineExcerpt,
} from '../helpers/pull-request-inline-threads'
import type { PullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
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
		return (
			<div className="h-24 animate-pulse border-border border-t bg-muted/40" />
		)

	if (diffQuery.isError)
		return (
			<div className="border-border border-t">
				<p className="p-4 text-destructive text-sm">
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
	const [activeAnchor, setActiveAnchor] = useState<PullRequestThreadAnchor>()

	if (diff.file.isBinary)
		return (
			<p className="border-border border-t p-4 text-muted-foreground text-sm">
				Binary file changed. A text diff is unavailable.
			</p>
		)

	if (diff.hunks.length === 0)
		return (
			<div className="border-border border-t">
				<p className="p-4 text-muted-foreground text-sm">
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
		activeAnchor,
		anchorableSides,
		number,
		onComment: (anchor, content) =>
			setActiveAnchor({
				path: anchor.path,
				side: anchor.side,
				line: anchor.line,
				anchorSha: anchor.sha,
				baseSha: anchorComparison.baseSha,
				headSha: anchorComparison.headSha,
				lineExcerpt: toThreadLineExcerpt(content),
			}),
		onComposerDone: () => setActiveAnchor(undefined),
		permissions,
		slug,
		threads: placeableThreads,
		username,
	}

	return (
		<div className="overflow-x-auto border-border border-t bg-background">
			{diff.isTruncated && (
				<p className="border-border border-b px-4 py-2 text-amber-300 text-xs">
					Diff truncated at {diff.patchLimitBytes.toLocaleString()} bytes.
				</p>
			)}
			<div
				className="min-w-[80rem] font-mono text-xs leading-5 [font-feature-settings:'liga'_0,'calt'_0] [font-variant-ligatures:none]"
				data-diff-code
			>
				{diff.hunks.map(hunk => (
					<div key={hunk.header}>
						<div className="bg-secondary px-4 py-2 text-muted-foreground">
							{hunk.header}
						</div>
						{getSplitDiffRows(hunk.lines).map((row, index) => (
							<DiffRow
								key={`${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}:${index}`}
								row={row}
								threading={threading}
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
type PullRequestDiffAnchor = NonNullable<PullRequestDiffLine['old']>

interface PullRequestDiffThreading {
	username: string
	slug: string
	number: string
	permissions: PullRequestThreadPermissions
	threads: PullRequestThread[]
	anchorableSides: readonly PullRequestThreadSide[]
	activeAnchor?: PullRequestThreadAnchor
	onComment: (anchor: PullRequestDiffAnchor, content: string) => void
	onComposerDone: () => void
}

interface DiffRowProps {
	row: SplitDiffRow
	threading: PullRequestDiffThreading
}

function DiffRow({ row, threading }: Readonly<DiffRowProps>) {
	const {
		activeAnchor,
		anchorableSides,
		number,
		permissions,
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
	const leftAnchor =
		activeAnchor?.side === 'left' && activeAnchor.line === leftLine
			? activeAnchor
			: undefined
	const rightAnchor =
		activeAnchor?.side === 'right' && activeAnchor.line === rightLine
			? activeAnchor
			: undefined
	const onComment = permissions.canComment ? threading.onComment : undefined

	return (
		<>
			<div className="group/diff-row grid grid-cols-[3.5rem_2rem_minmax(32rem,1fr)_3.5rem_2rem_minmax(32rem,1fr)]">
				<DiffSide
					line={row.left}
					onComment={anchorableSides.includes('left') ? onComment : undefined}
					side="left"
				/>
				<DiffSide
					line={row.right}
					onComment={anchorableSides.includes('right') ? onComment : undefined}
					side="right"
				/>
			</div>
			{(leftThreads.length > 0 || leftAnchor) && (
				<PullRequestDiffThreadRow
					anchor={leftAnchor}
					number={number}
					onComposerDone={threading.onComposerDone}
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
					onComposerDone={threading.onComposerDone}
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

interface DiffSideProps {
	line?: PullRequestDiffLine
	side: 'left' | 'right'
	onComment?: (anchor: PullRequestDiffAnchor, content: string) => void
}

function DiffSide({ line, side, onComment }: Readonly<DiffSideProps>) {
	const tone: DiffLineTone = line?.kind ?? 'empty'
	const anchor = side === 'left' ? line?.old : line?.new

	return (
		<div
			className="contents"
			data-empty={tone === 'empty' || undefined}
			data-side={side}
		>
			<span
				className={cn(
					'relative select-none border-border border-r px-2 text-right text-muted-foreground',
					DIFF_GUTTER_TONE_CLASSES[tone]
				)}
			>
				{onComment && line && anchor && (
					<button
						aria-label={`Comment on ${side === 'left' ? 'original' : 'updated'} line ${anchor.line}`}
						className="absolute top-1/2 left-1 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm bg-primary text-primary-foreground opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/diff-row:opacity-100"
						onClick={() => onComment(anchor, line.content)}
						type="button"
					>
						<Plus aria-hidden className="size-3" />
					</button>
				)}
				{anchor?.line}
			</span>
			<span
				className={cn(
					'select-none text-center text-muted-foreground',
					DIFF_CELL_TONE_CLASSES[tone]
				)}
			>
				{DIFF_LINE_PREFIXES[tone]}
			</span>
			<span
				className={cn(
					'whitespace-pre-wrap pr-4 [overflow-wrap:anywhere]',
					side === 'left' && 'border-border border-r',
					DIFF_CELL_TONE_CLASSES[tone]
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
