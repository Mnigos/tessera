import type { PullRequestListItem as PullRequestListItemData } from '@repo/contracts'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import { PullRequestReviewSummaryBadges } from './pull-request-review-summary-badges'
import { PullRequestStateBadge } from './pull-request-state-badge'

interface PullRequestListItemProps {
	username: string
	slug: string
	pullRequest: PullRequestListItemData
}

export function PullRequestListItem({
	username,
	slug,
	pullRequest,
}: Readonly<PullRequestListItemProps>) {
	return (
		<li className="flex min-w-0 items-start justify-between gap-4 px-4 py-3">
			<div className="flex min-w-0 flex-col gap-1">
				<Link
					className="truncate font-medium text-foreground text-sm hover:underline"
					params={{ username, slug, number: String(pullRequest.number) }}
					to="/$username/$slug/pulls/$number"
				>
					{pullRequest.title}
				</Link>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
					<span>#{pullRequest.number}</span>
					<span>by {pullRequest.authorUsername}</span>
					<span className="inline-flex min-w-0 max-w-full items-center gap-1">
						<span
							className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 font-mono sm:max-w-48"
							title={pullRequest.sourceBranch}
						>
							{pullRequest.sourceBranch}
						</span>
						<ArrowRight aria-hidden className="size-3" />
						<span
							className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 font-mono sm:max-w-48"
							title={pullRequest.targetBranch}
						>
							{pullRequest.targetBranch}
						</span>
					</span>
					<span>
						opened{' '}
						<time dateTime={formatPullRequestDateTime(pullRequest.createdAt)}>
							{formatPullRequestDate(pullRequest.createdAt)}
						</time>
					</span>
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-2">
				<PullRequestStateBadge state={pullRequest.state} />
				<PullRequestReviewSummaryBadges summary={pullRequest.reviewSummary} />
			</div>
		</li>
	)
}
