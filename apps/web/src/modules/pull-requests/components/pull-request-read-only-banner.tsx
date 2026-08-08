import { Card } from '@repo/ui/components/card'
import { PullRequestSourceLink } from './pull-request-source-link'

interface PullRequestReadOnlyBannerProps {
	sourceUrl?: string
}

/**
 * Says plainly that GitHub owns this pull request, so the missing comment,
 * review, and merge controls read as a deliberate boundary rather than as
 * permissions the viewer is somehow lacking.
 */
export function PullRequestReadOnlyBanner({
	sourceUrl,
}: Readonly<PullRequestReadOnlyBannerProps>) {
	return (
		<Card className="gap-2 p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="font-semibold text-sm tracking-normal">
					Synchronized from GitHub
				</h2>
				<span className="inline-flex rounded-md border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
					Read-only in Tessera
				</span>
			</div>
			<p className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground text-sm">
				<span>
					Comments, reviews, and merges happen on GitHub and appear here once
					they sync.
				</span>
				{sourceUrl && <PullRequestSourceLink href={sourceUrl} />}
			</p>
		</Card>
	)
}
