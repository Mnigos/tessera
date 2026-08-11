import { Github } from 'lucide-react'
import { PullRequestSourceLink } from './pull-request-source-link'

interface PullRequestGitHubBadgeProps {
	sourceUrl?: string
}

/**
 * Where this pull request came from, beside its state rather than in a card
 * below it. Provenance outlives authority: a pull request synchronized from
 * GitHub still came from GitHub after the repository cuts over to Tessera, so
 * this is drawn from the pull request's own origin and not from who may write
 * to it now.
 */
export function PullRequestGitHubBadge({
	sourceUrl,
}: Readonly<PullRequestGitHubBadgeProps>) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 font-medium text-muted-foreground text-xs">
			<Github aria-hidden className="size-3.5 shrink-0" />
			<span>From GitHub</span>
			{sourceUrl && (
				<PullRequestSourceLink
					className="border-border border-l pl-1.5"
					href={sourceUrl}
					label="View on GitHub"
				/>
			)}
		</span>
	)
}
