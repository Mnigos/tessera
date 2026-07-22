import type { PullRequestFileDiff } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'

interface PullRequestFileDiffViewProps {
	expectedBaseSha: string
	expectedHeadSha: string
	username: string
	slug: string
	number: string
	path: string
}

export function PullRequestFileDiffView(
	props: Readonly<PullRequestFileDiffViewProps>
) {
	const diffQuery = usePullRequestFileDiffQuery(props, true)

	if (diffQuery.isLoading)
		return (
			<div className="h-24 animate-pulse border-border border-t bg-muted/40" />
		)

	if (diffQuery.isError)
		return (
			<p className="border-border border-t p-4 text-destructive text-sm">
				The file diff could not be loaded.
			</p>
		)

	if (!diffQuery.data) return null

	return <FileDiff diff={diffQuery.data} />
}

function FileDiff({ diff }: Readonly<{ diff: PullRequestFileDiff }>) {
	if (diff.file.isBinary)
		return (
			<p className="border-border border-t p-4 text-muted-foreground text-sm">
				Binary file changed. A text diff is unavailable.
			</p>
		)

	if (diff.hunks.length === 0)
		return (
			<p className="border-border border-t p-4 text-muted-foreground text-sm">
				No text changes to display.
			</p>
		)

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
							<div
								className="grid grid-cols-[3.5rem_2rem_minmax(32rem,1fr)_3.5rem_2rem_minmax(32rem,1fr)]"
								key={`${row.left?.old?.line ?? '-'}:${row.right?.new?.line ?? '-'}:${index}`}
							>
								<DiffSide line={row.left} side="left" />
								<DiffSide line={row.right} side="right" />
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	)
}

type PullRequestDiffLine = PullRequestFileDiff['hunks'][number]['lines'][number]

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

interface DiffSideProps {
	line?: PullRequestDiffLine
	side: 'left' | 'right'
}

function DiffSide({ line, side }: Readonly<DiffSideProps>) {
	const isEmpty = !line
	const isDeletion = line?.kind === 'deletion'
	const isAddition = line?.kind === 'addition'
	const lineNumber = side === 'left' ? line?.old?.line : line?.new?.line
	const prefix = isDeletion ? '−' : isAddition ? '+' : line ? ' ' : ''

	return (
		<div
			className="contents"
			data-empty={isEmpty || undefined}
			data-side={side}
		>
			<span
				className={cn(
					'select-none border-border border-r px-2 text-right text-muted-foreground',
					isDeletion && 'bg-red-950/50',
					isAddition && 'bg-emerald-950/50',
					isEmpty && 'bg-muted/20'
				)}
			>
				{lineNumber}
			</span>
			<span
				className={cn(
					'select-none text-center text-muted-foreground',
					isDeletion && 'bg-red-950/35',
					isAddition && 'bg-emerald-950/35',
					isEmpty && 'bg-muted/20'
				)}
			>
				{prefix}
			</span>
			<span
				className={cn(
					'whitespace-pre-wrap pr-4 [overflow-wrap:anywhere]',
					side === 'left' && 'border-border border-r',
					isDeletion && 'bg-red-950/35',
					isAddition && 'bg-emerald-950/35',
					isEmpty && 'bg-muted/20'
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
