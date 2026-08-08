import type { ChecksSummary } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import {
	getCheckRollupCount,
	getCheckRollupDescription,
	getCheckRollupPresentation,
} from '../helpers/pull-request-checks'

interface PullRequestChecksSummaryBadgeProps {
	summary?: ChecksSummary
}

/**
 * A list row's worth of check news: the one count the rollup is about. A commit
 * nothing has reported on says nothing at all.
 */
export function PullRequestChecksSummaryBadge({
	summary,
}: Readonly<PullRequestChecksSummaryBadgeProps>) {
	if (!summary || summary.overall === 'none') return null

	const presentation = getCheckRollupPresentation(summary.overall)
	const description = getCheckRollupDescription(summary)

	return (
		<span
			className={cn(
				'inline-flex shrink-0 items-center gap-1 text-xs',
				presentation.iconClassName
			)}
			title={description}
		>
			<presentation.icon aria-hidden className="size-3.5" />
			{getCheckRollupCount(summary)}
			<span className="sr-only">{description}</span>
		</span>
	)
}
