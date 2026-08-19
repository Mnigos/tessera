import { Button } from '@repo/ui/components/button'
import { Progress } from '@repo/ui/components/progress'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@repo/ui/components/tooltip'
import { Keyboard, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ReactNode } from 'react'

interface PullRequestDiffRailProps {
	fileCount: number
	/** Absent until the viewed state is known, so the gauge cannot claim a total. */
	viewedCount?: number
	isTreeOpen: boolean
	onToggleTree: () => void
	/** The comparison switch, which leads the rail before the counter. */
	lead?: ReactNode
	/** The review trigger, which closes the rail on the right. */
	action?: ReactNode
}

/**
 * The two anchors a reviewer must never lose — how much is left, and how to
 * submit — pinned to the top of the diff for the whole of a 40,000 px document.
 */
export function PullRequestDiffRail({
	fileCount,
	viewedCount,
	isTreeOpen,
	onToggleTree,
	lead,
	action,
}: Readonly<PullRequestDiffRailProps>) {
	const TreeIcon = isTreeOpen ? PanelLeftClose : PanelLeftOpen
	const progress =
		viewedCount === undefined || fileCount === 0
			? undefined
			: Math.round((viewedCount / fileCount) * 100)

	return (
		<div className="sticky top-0 z-20 flex h-[var(--review-rail-h)] items-center justify-between gap-3 border-border border-b bg-background/95 backdrop-blur">
			<div className="flex min-w-0 items-center gap-3">
				<Button
					aria-label={isTreeOpen ? 'Hide the file tree' : 'Show the file tree'}
					aria-pressed={isTreeOpen}
					className="hidden size-7 lg:inline-flex"
					onClick={onToggleTree}
					size="icon"
					variant="ghost"
				>
					<TreeIcon aria-hidden className="size-4" />
				</Button>
				{lead}
				<div className="flex min-w-0 items-center gap-2">
					{progress !== undefined && (
						<Progress
							aria-label="Files viewed"
							className="h-1.5 w-16 shrink-0 bg-secondary"
							value={progress}
						/>
					)}
					<p className="truncate font-medium text-xs tabular-nums">
						{viewedCount === undefined
							? `${fileCount} changed files`
							: `${viewedCount} / ${fileCount} files viewed`}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{action}
				<Tooltip>
					<TooltipTrigger render={<span className="inline-flex" />}>
						<Button
							aria-label="Keyboard shortcuts"
							className="size-7"
							disabled
							size="icon"
							variant="ghost"
						>
							<Keyboard aria-hidden className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Keyboard shortcuts — coming soon</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)
}
