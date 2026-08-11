import type { PullRequestActor, PullRequestEvent } from '@repo/contracts'
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
		<div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-1 text-muted-foreground text-sm">
			<span className="min-w-0">
				<PullRequestEventDescription event={event} /> by{' '}
				<PullRequestEventActor
					actor={event.actor}
					actorUsername={event.actorUsername}
				/>
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

interface PullRequestEventActorProps {
	actor?: PullRequestActor
	actorUsername?: string
}

/**
 * Who did it, with the identity the projection kept.
 *
 * A synchronized event has a GitHub account behind it that exists nowhere in
 * Tessera, so it is shown as GitHub shows it — avatar and a link to the profile
 * — rather than as a bare login the reader has no way to place. Queue
 * transitions nobody performed keep saying Tessera.
 */
function PullRequestEventActor({
	actor,
	actorUsername,
}: Readonly<PullRequestEventActorProps>) {
	const username = actor?.username ?? actorUsername ?? 'Tessera'

	if (actor?.provider !== 'github')
		return <span className="font-medium text-foreground">{username}</span>

	const identity = (
		<>
			{actor.avatarUrl && (
				// Decorative: the login it belongs to is rendered right beside it, so
				// naming the actor twice would only make the row longer to hear.
				<img
					alt=""
					className="size-4 shrink-0 rounded-full bg-muted"
					height={16}
					src={actor.avatarUrl}
					width={16}
				/>
			)}
			<span className="truncate font-medium text-foreground">{username}</span>
		</>
	)

	if (!actor.htmlUrl)
		return (
			<span className="inline-flex min-w-0 items-center gap-1.5">
				{identity}
			</span>
		)

	return (
		<a
			className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
			href={actor.htmlUrl}
			rel="noreferrer"
			target="_blank"
		>
			{identity}
		</a>
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
