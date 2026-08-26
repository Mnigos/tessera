import type { PullRequestThread } from '@repo/contracts'
import { usePullRequestThreadExcerptQuery } from '../hooks/use-pull-request-thread-excerpt.query'

interface PullRequestThreadExcerptProps {
	username: string
	slug: string
	number: string
	anchor: NonNullable<PullRequestThread['anchor']>
}

/**
 * The code a thread was written against, resolved from the commits the anchor
 * pinned — so it stays readable long after the diff has moved on. A range shows
 * every line it covers; a single line keeps the stored excerpt and costs no
 * request.
 */
export function PullRequestThreadExcerpt({
	username,
	slug,
	number,
	anchor,
}: Readonly<PullRequestThreadExcerptProps>) {
	const isRange = anchor.startLine < anchor.endLine
	const linesQuery = usePullRequestThreadExcerptQuery(
		{ username, slug, number, anchor },
		isRange
	)

	const lines = isRange ? linesQuery.data?.lines : undefined

	if (!lines || lines.length === 0)
		return anchor.lineExcerpt.trim() ? (
			<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-muted-foreground text-xs">
				{anchor.lineExcerpt}
			</pre>
		) : null

	return (
		<div className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 font-mono text-xs leading-5">
			{lines.map((line, index) => {
				const lineNumber =
					(anchor.side === 'left' ? line.old?.line : line.new?.line) ??
					anchor.startLine + index

				return (
					<div className="flex" key={lineNumber}>
						<span className="w-12 shrink-0 select-none px-2 text-right text-muted-foreground/70">
							{lineNumber}
						</span>
						<span className="flex-1 whitespace-pre pr-3">
							{line.html ? (
								<span
									dangerouslySetInnerHTML={{ __html: line.html }}
									data-shiki=""
								/>
							) : (
								line.content
							)}
						</span>
					</div>
				)
			})}
		</div>
	)
}
