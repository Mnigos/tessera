import type { PullRequestEvent } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import {
	formatPullRequestActor,
	formatPullRequestDate,
	formatPullRequestDateTime,
	getPullRequestEventLabel,
} from '../helpers/pull-request-formatting'

interface PullRequestEventsProps {
	events: PullRequestEvent[]
}

export function PullRequestEvents({
	events,
}: Readonly<PullRequestEventsProps>) {
	if (events.length === 0) return null

	return (
		<Card className="gap-3">
			<h2 className="font-semibold text-base tracking-normal">Activity</h2>
			<ol className="flex flex-col gap-2">
				{events.map(event => (
					<li
						className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
						key={event.id}
					>
						<span>
							{getPullRequestEventLabel(event.type)} by{' '}
							{formatPullRequestActor(event.actorUserId)}
						</span>
						<time
							className="text-muted-foreground text-xs"
							dateTime={formatPullRequestDateTime(event.createdAt)}
						>
							{formatPullRequestDate(event.createdAt)}
						</time>
					</li>
				))}
			</ol>
		</Card>
	)
}
