import { Button } from '@repo/ui/components/button'
import { Checkbox } from '@repo/ui/components/checkbox'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@repo/ui/components/popover'
import { Progress } from '@repo/ui/components/progress'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@repo/ui/components/tooltip'
import { cn } from '@repo/ui/utils'
import {
	Keyboard,
	MoreHorizontal,
	PanelLeftClose,
	PanelLeftOpen,
	Search,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
	type PullRequestDiffView,
	setPullRequestDiffView,
	setPullRequestDiffWrap,
	usePullRequestDiffViewOptions,
} from '../hooks/use-pull-request-diff-view-options'

const DIFF_VIEW_LABELS = {
	split: 'Split',
	unified: 'Unified',
} as const satisfies Record<PullRequestDiffView, string>

const DIFF_VIEWS = ['split', 'unified'] as const satisfies PullRequestDiffView[]

const WRAP_CHECKBOX_ID = 'pull-request-diff-wrap'

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
	onFind: () => void
	onShowShortcuts: () => void
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
	onFind,
	onShowShortcuts,
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
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Find in this diff"
								className="size-7"
								onClick={onFind}
								size="icon"
								variant="ghost"
							/>
						}
					>
						<Search aria-hidden className="size-4" />
					</TooltipTrigger>
					<TooltipContent>Find in this diff — ⌘F</TooltipContent>
				</Tooltip>
				<PullRequestDiffViewControls />
				{action}
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Keyboard shortcuts"
								className="size-7"
								onClick={onShowShortcuts}
								size="icon"
								variant="ghost"
							/>
						}
					>
						<Keyboard aria-hidden className="size-4" />
					</TooltipTrigger>
					<TooltipContent>Keyboard shortcuts — ?</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)
}

/** Layout choices that outlive the page, so the rail reads them rather than being told. */
function PullRequestDiffViewControls() {
	const { view, isWrapped } = usePullRequestDiffViewOptions()

	return (
		<div className="flex items-center gap-1">
			<fieldset className="flex h-7 items-center gap-0.5 rounded-md border border-border p-0.5">
				<legend className="sr-only">Diff layout</legend>
				{DIFF_VIEWS.map(candidate => (
					<button
						aria-pressed={view === candidate}
						className={cn(
							'h-6 cursor-pointer rounded-[3px] px-2 text-xs transition-colors duration-[90ms] ease-out focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
							view === candidate
								? 'bg-secondary font-medium text-foreground'
								: 'text-muted-foreground hover:text-foreground'
						)}
						key={candidate}
						onClick={() => setPullRequestDiffView(candidate)}
						type="button"
					>
						{DIFF_VIEW_LABELS[candidate]}
					</button>
				))}
			</fieldset>
			<Popover>
				<PopoverTrigger
					render={
						<Button
							aria-label="Diff options"
							className="size-7"
							size="icon"
							variant="ghost"
						/>
					}
				>
					<MoreHorizontal aria-hidden className="size-4" />
				</PopoverTrigger>
				<PopoverContent align="end" className="w-52 p-2">
					<label
						className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-secondary"
						htmlFor={WRAP_CHECKBOX_ID}
					>
						<Checkbox
							checked={isWrapped}
							id={WRAP_CHECKBOX_ID}
							onCheckedChange={setPullRequestDiffWrap}
						/>
						Wrap lines
					</label>
				</PopoverContent>
			</Popover>
		</div>
	)
}
