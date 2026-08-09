import { Card } from '@repo/ui/components/card'

/** Stands in for whichever comparison the files or commits view is loading. */
export function PullRequestComparisonSkeleton() {
	return (
		<Card className="gap-3">
			<div className="h-5 w-40 animate-pulse rounded bg-muted" />
			<div className="h-20 animate-pulse rounded bg-muted/70" />
		</Card>
	)
}
