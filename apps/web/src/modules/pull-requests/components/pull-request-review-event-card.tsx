import type { PullRequestEvent, PullRequestReview } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { MessageSquare } from 'lucide-react'
import { MarkdownContent } from '@/shared/components/markdown-content'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewEventPayload,
	getPullRequestReviewOutcomePresentation,
} from '../helpers/pull-request-review'

interface PullRequestReviewEventCardProps {
	event: PullRequestEvent
	review?: PullRequestReview
}

export function PullRequestReviewEventCard({
	event,
	review,
}: Readonly<PullRequestReviewEventCardProps>) {
	const outcome = getPullRequestReviewEventPayload(event)?.outcome
	const presentation = outcome
		? getPullRequestReviewOutcomePresentation(outcome)
		: undefined
	const OutcomeIcon = presentation?.icon ?? MessageSquare

	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-lg border p-4',
				presentation?.cardClassName ?? 'border-border bg-card'
			)}
		>
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<OutcomeIcon
					aria-hidden
					className={cn(
						'size-4 shrink-0 self-center',
						presentation?.iconClassName ?? 'text-muted-foreground'
					)}
				/>
				<span className="font-medium text-sm">
					{event.actorUsername} {presentation?.timelineLabel ?? 'left a review'}
				</span>
				<time
					className="ml-auto text-muted-foreground text-xs"
					dateTime={formatPullRequestDateTime(event.createdAt)}
				>
					{formatPullRequestDate(event.createdAt)}
				</time>
			</div>
			{review?.body && <MarkdownContent>{review.body}</MarkdownContent>}
		</div>
	)
}
