import type { PullRequestEvent } from '@repo/contracts'
import type { ReactNode } from 'react'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
	formatPullRequestShortSha,
	getPullRequestEventDescription,
	getPullRequestHeadUpdate,
	getPullRequestRetarget,
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
				<PullRequestEventDescription event={event} /> by{' '}
				{event.actorUsername ?? 'Tessera'}
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

/**
 * What happened, told from the payload when the event carries one. Branch
 * movements are worth naming the branches of; everything else, and every
 * provider-synchronized event, falls back to its label.
 */
function PullRequestEventDescription({
	event,
}: Readonly<PullRequestEventRowProps>) {
	const headUpdate = getPullRequestHeadUpdate(event)

	if (headUpdate)
		return (
			<>
				{headUpdate.verb} <CodeLabel>{headUpdate.branch}</CodeLabel> from{' '}
				<CodeLabel title={headUpdate.oldSha}>
					{formatPullRequestShortSha(headUpdate.oldSha)}
				</CodeLabel>{' '}
				to{' '}
				<CodeLabel title={headUpdate.newSha}>
					{formatPullRequestShortSha(headUpdate.newSha)}
				</CodeLabel>
			</>
		)

	const retarget = getPullRequestRetarget(event)

	if (retarget)
		return (
			<>
				Changed the target from <CodeLabel>{retarget.fromBranch}</CodeLabel> to{' '}
				<CodeLabel>{retarget.toBranch}</CodeLabel>
			</>
		)

	return <>{getPullRequestEventDescription(event)}</>
}

/** A branch or a commit, with the full value in reach for the commits. */
function CodeLabel({
	children,
	title,
}: Readonly<{ children: ReactNode; title?: string }>) {
	return (
		<code className="rounded bg-muted px-1 py-0.5 text-xs" title={title}>
			{children}
		</code>
	)
}
