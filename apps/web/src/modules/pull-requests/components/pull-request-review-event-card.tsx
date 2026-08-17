import type { PullRequestEvent, PullRequestReview } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { GitCompareArrows, MessageSquare } from 'lucide-react'
import { MarkdownContent } from '@/shared/components/markdown-content'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewEventPayload,
	getPullRequestReviewOutcomePresentation,
} from '../helpers/pull-request-review'
import { PullRequestActorLabel } from './pull-request-actor-label'
import { PullRequestSourceLink } from './pull-request-source-link'

interface PullRequestReviewEventCardProps {
	username: string
	slug: string
	number: string
	event: PullRequestEvent
	review?: PullRequestReview
}

export function PullRequestReviewEventCard({
	username,
	slug,
	number,
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
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<OutcomeIcon
					aria-hidden
					className={cn(
						'size-4 shrink-0',
						presentation?.iconClassName ?? 'text-muted-foreground'
					)}
				/>
				<span className="font-medium text-sm">
					{event.actor ? (
						<PullRequestActorLabel actor={event.actor} />
					) : (
						event.actorUsername
					)}{' '}
					{presentation?.timelineLabel ?? 'left a review'}
				</span>
				{review?.state === 'dismissed' && (
					<span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
						Dismissed
					</span>
				)}
				<time
					className="ml-auto text-muted-foreground text-xs"
					dateTime={formatPullRequestDateTime(event.createdAt)}
				>
					{formatPullRequestDate(event.createdAt)}
				</time>
			</div>
			{review?.body && <MarkdownContent>{review.body}</MarkdownContent>}
			{review && (
				<div className="flex flex-wrap items-center gap-3">
					<Link
						className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
						params={{ username, slug, number }}
						search={{ reviewId: review.id }}
						to="/$username/$slug/pulls/$number/files"
					>
						<GitCompareArrows aria-hidden className="size-3" />
						View changes since this review
					</Link>
					{review.sourceUrl && (
						<PullRequestSourceLink
							className="text-muted-foreground text-xs"
							href={review.sourceUrl}
						/>
					)}
				</div>
			)}
		</div>
	)
}
