import type { PullRequestEvent } from '@repo/contracts'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
	getPullRequestEventDescription,
} from '../helpers/pull-request-formatting'

interface PullRequestEventRowProps {
	event: PullRequestEvent
}

export function PullRequestEventRow({
	event,
}: Readonly<PullRequestEventRowProps>) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-2 px-1 text-muted-foreground text-sm">
			<span>
				{getPullRequestEventDescription(event)} by {event.actorUsername}
			</span>
			<time
				className="text-xs"
				dateTime={formatPullRequestDateTime(event.createdAt)}
			>
				{formatPullRequestDate(event.createdAt)}
			</time>
		</div>
	)
}
