import type { PullRequestState } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { CircleDot, GitMerge, XCircle } from 'lucide-react'
import { getPullRequestStateLabel } from '../helpers/pull-request-formatting'

const PULL_REQUEST_STATE_BADGE_CLASSES: Record<PullRequestState, string> = {
	open: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
	closed: 'border-red-500/30 bg-red-500/10 text-red-400',
	merged: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
}

const PULL_REQUEST_STATE_BADGE_ICONS = {
	open: CircleDot,
	closed: XCircle,
	merged: GitMerge,
} satisfies Record<PullRequestState, typeof CircleDot>

interface PullRequestStateBadgeProps {
	state: PullRequestState
}

export function PullRequestStateBadge({
	state,
}: Readonly<PullRequestStateBadgeProps>) {
	const Icon = PULL_REQUEST_STATE_BADGE_ICONS[state]

	return (
		<span
			className={cn(
				'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-xs',
				PULL_REQUEST_STATE_BADGE_CLASSES[state]
			)}
		>
			<Icon aria-hidden className="size-3.5" />
			{getPullRequestStateLabel(state)}
		</span>
	)
}
