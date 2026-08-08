import type { PullRequestReviewSummary } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { CircleCheck, CircleX, Clock, History } from 'lucide-react'

interface PullRequestReviewSummaryBadgesProps {
	summary: PullRequestReviewSummary
}

export function PullRequestReviewSummaryBadges({
	summary,
}: Readonly<PullRequestReviewSummaryBadgesProps>) {
	const badges = [
		{
			key: 'approved',
			count: summary.approvedCount,
			label: 'approved',
			icon: CircleCheck,
			className: 'text-emerald-400',
		},
		{
			key: 'changes',
			count: summary.changeRequestCount,
			label: 'requested changes',
			icon: CircleX,
			className: 'text-rose-400',
		},
		{
			key: 'requested',
			count: summary.requestedCount,
			label: 'awaiting review',
			icon: Clock,
			className: 'text-muted-foreground',
		},
		{
			key: 'stale',
			count: summary.staleCount,
			label: 'stale',
			icon: History,
			className: 'text-amber-400',
		},
	].filter(badge => badge.count > 0)

	if (badges.length === 0) return null

	return (
		<span className="flex shrink-0 items-center gap-2">
			{badges.map(badge => (
				<span
					className={cn(
						'inline-flex items-center gap-1 text-xs',
						badge.className
					)}
					key={badge.key}
					title={`${badge.count} ${badge.label}`}
				>
					<badge.icon aria-hidden className="size-3.5" />
					{badge.count}
					<span className="sr-only">{badge.label}</span>
				</span>
			))}
		</span>
	)
}
