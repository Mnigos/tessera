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
			{diff.hunks.map(hunk => (
				<div key={hunk.header}>
					<div className="min-w-max bg-secondary px-4 py-2 font-mono text-muted-foreground text-xs">
						{hunk.header}
					</div>
					<pre className="min-w-max text-xs leading-5">
						<code>
							{hunk.lines.map((line, index) => (
								<DiffLine
									key={`${line.old?.line ?? '-'}:${line.new?.line ?? '-'}:${index}`}
									line={line}
								/>
							))}
						</code>
					</pre>
				</div>
			))}
		</div>
	)
}

function DiffLine({
	line,
}: Readonly<{ line: PullRequestFileDiff['hunks'][number]['lines'][number] }>) {
	const prefix =
		line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '

	return (
		<span
			className={cn(
				'grid grid-cols-[3.5rem_3.5rem_2rem_1fr]',
				line.kind === 'addition' && 'bg-emerald-950/35',
				line.kind === 'deletion' && 'bg-red-950/35'
			)}
		>
			<span className="select-none border-border border-r px-2 text-right text-muted-foreground">
				{line.old?.line}
			</span>
			<span className="select-none border-border border-r px-2 text-right text-muted-foreground">
				{line.new?.line}
			</span>
			<span className="select-none text-center text-muted-foreground">
				{prefix}
			</span>
			<span className="pr-4 font-mono">
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
			</span>
		</span>
	)
}
