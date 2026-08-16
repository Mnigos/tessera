import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@repo/ui/components/tooltip'
import { Info } from 'lucide-react'

interface PullRequestGitHubWriteThroughNoteProps {
	/** False for a native pull request frozen by mirroring: it has no GitHub copy. */
	isFromGitHub: boolean
}

/** Attribution, not a boundary: what is typed here reaches GitHub as the reader. */
export function PullRequestGitHubWriteThroughNote({
	isFromGitHub,
}: Readonly<PullRequestGitHubWriteThroughNoteProps>) {
	const label = isFromGitHub ? 'GitHub owns this' : 'GitHub is the source'
	const detail = isFromGitHub
		? 'GitHub owns this pull request. Anything you post here is sent to GitHub as you.'
		: 'GitHub is the source of truth for this repository; changes you make here are sent to GitHub as you.'

	return (
		<Tooltip>
			<TooltipTrigger
				className="inline-flex cursor-help items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-muted-foreground text-xs"
				render={<span role="note" />}
			>
				<Info aria-hidden className="size-3" />
				<span aria-hidden>{label}</span>
				{/* The chip abbreviates; the sentence still has to reach a screen reader. */}
				<span className="sr-only">{detail}</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-72">{detail}</TooltipContent>
		</Tooltip>
	)
}
