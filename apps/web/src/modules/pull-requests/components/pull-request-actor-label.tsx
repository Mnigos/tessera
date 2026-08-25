import type { PullRequestActor } from '@repo/contracts'
import { Avatar } from '@repo/ui/components/avatar'
import { cn } from '@repo/ui/utils'
import { getPullRequestActorName } from '../helpers/pull-request-formatting'

interface PullRequestActorLabelProps {
	actor: PullRequestActor
	className?: string
}

/**
 * An actor as GitHub prints one: avatar, then the profile name. The login stays
 * on the title, because a display name is renameable and shared, so it can
 * never be the only thing saying who acted.
 */
export function PullRequestActorLabel({
	actor,
	className,
}: Readonly<PullRequestActorLabelProps>) {
	return (
		<span
			// align-middle keeps the name on the surrounding text's line when the
			// label sits inside a sentence: the avatar image would otherwise donate
			// its bottom edge as the baseline and lift the whole label.
			className={cn(
				'inline-flex min-w-0 items-center gap-1.5 align-middle',
				className
			)}
			title={actor.username}
		>
			<PullRequestActorAvatar actor={actor} />
			<span className="truncate font-medium">
				{getPullRequestActorName(actor)}
			</span>
		</span>
	)
}

interface PullRequestActorAvatarProps {
	actor: PullRequestActor
}

export function PullRequestActorAvatar({
	actor,
}: Readonly<PullRequestActorAvatarProps>) {
	if (!actor.avatarUrl)
		return (
			<Avatar
				className="size-5 shrink-0 text-[0.625rem]"
				displayName={getPullRequestActorName(actor)}
				size="sm"
			/>
		)

	// Decorative: the name it belongs to is rendered right beside it, so naming
	// the actor twice would only make the row longer to hear.
	return (
		<img
			alt=""
			className="size-5 shrink-0 rounded-full bg-muted"
			height={20}
			src={actor.avatarUrl}
			width={20}
		/>
	)
}
