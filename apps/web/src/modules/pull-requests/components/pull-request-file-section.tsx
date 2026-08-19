import type {
	PullRequestChangedFile,
	PullRequestChangedFileStatus,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Toggle } from '@repo/ui/components/toggle'
import { cn } from '@repo/ui/utils'
import { Check, ChevronRight } from 'lucide-react'
import { memo, type PropsWithChildren, useCallback } from 'react'
import { isLargeChangedFile } from '../helpers/pull-request-changed-files'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'

export const FILE_STATUS_LETTERS = {
	added: 'A',
	deleted: 'D',
	modified: 'M',
	renamed: 'R',
} as const satisfies Record<PullRequestChangedFileStatus, string>

export const FILE_STATUS_CLASSES = {
	added: 'bg-diff-add-marker text-background',
	deleted: 'bg-diff-del-marker text-background',
	modified: 'bg-primary text-primary-foreground',
	renamed: 'bg-diff-hunk-action text-background',
} as const satisfies Record<PullRequestChangedFileStatus, string>

const DIFF_ROW_HEIGHT = 22
// The counts leave out the context lines a hunk shows around each change.
const CONTEXT_ROWS = 8
const MAX_BODY_ESTIMATE = 2000

interface PullRequestFileSectionProps extends PropsWithChildren {
	file: PullRequestChangedFile
	path: string
	displayPath: string
	isExpanded: boolean
	isViewed: boolean
	/** The file moved on after the reader's own last submitted review. */
	isChangedSinceReview: boolean
	canMarkViewed: boolean
	isViewedPending: boolean
	isMounted: boolean
	/** The height an evicted diff left behind, so the page below it stays put. */
	placeholderHeight?: number
	onToggleExpanded: (path: string, isExpanded: boolean) => void
	onToggleViewed: (path: string, viewed: boolean) => void
	onPrefetch: (file: PullRequestChangedFile) => void
	onRegisterNode: (path: string, node: HTMLElement | null) => void
}

function FileSection({
	file,
	path,
	displayPath,
	isExpanded,
	isViewed,
	isChangedSinceReview,
	canMarkViewed,
	isViewedPending,
	isMounted,
	placeholderHeight,
	onToggleExpanded,
	onToggleViewed,
	onPrefetch,
	onRegisterNode,
	children,
}: Readonly<PullRequestFileSectionProps>) {
	const observeSection = useCallback(
		(node: HTMLDivElement | null) => {
			if (!node) return

			onRegisterNode(path, node)

			return () => onRegisterNode(path, null)
		},
		[onRegisterNode, path]
	)
	const handleToggleExpanded = useCallback(
		() => onToggleExpanded(path, !isExpanded),
		[isExpanded, onToggleExpanded, path]
	)
	const handleToggleViewed = useCallback(
		(pressed: boolean) => onToggleViewed(path, pressed),
		[onToggleViewed, path]
	)
	const handlePrefetch = useCallback(() => onPrefetch(file), [file, onPrefetch])
	const separator = displayPath.lastIndexOf('/')
	const directory = separator < 0 ? '' : displayPath.slice(0, separator + 1)
	const name = displayPath.slice(separator + 1)

	return (
		<div
			className="scroll-mt-[var(--review-rail-h)]"
			data-file-path={path}
			ref={observeSection}
			style={placeholderHeight ? { minHeight: placeholderHeight } : undefined}
		>
			{/* The header outlives its own diff on screen, so it carries the page background. */}
			<div
				className={cn(
					'sticky top-[var(--review-rail-h)] z-10 flex h-9 items-center gap-2 bg-background pr-2',
					isExpanded && 'border-border border-b'
				)}
			>
				<Button
					aria-expanded={isExpanded}
					// The dimmed directory is its own span, which the name would read apart.
					aria-label={`${file.status} ${displayPath}${isChangedSinceReview ? ', changed since your last review' : ''}`}
					className="h-9 min-w-0 flex-1 justify-start gap-2 rounded-none px-2 py-0 text-left font-normal"
					onClick={handleToggleExpanded}
					onFocus={handlePrefetch}
					onPointerEnter={handlePrefetch}
					variant="ghost"
				>
					<ChevronRight
						className={cn(
							'size-4 shrink-0 text-muted-foreground transition-transform',
							isExpanded && 'rotate-90'
						)}
					/>
					<span
						aria-hidden
						className={cn(
							'flex size-3.5 shrink-0 items-center justify-center rounded-xs font-mono text-[0.625rem] leading-none',
							FILE_STATUS_CLASSES[file.status]
						)}
					>
						{FILE_STATUS_LETTERS[file.status]}
					</span>
					<span
						className={cn(
							'min-w-0 flex-1 truncate font-mono text-xs',
							isViewed && 'text-diff-viewed-fg'
						)}
						title={displayPath}
					>
						{directory && (
							<span className="text-muted-foreground">{directory}</span>
						)}
						{name}
					</span>
					{isChangedSinceReview && (
						<span
							className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-diff-comment-edge"
							title="Changed since your last review"
						>
							<span
								aria-hidden
								className="size-1.5 rounded-full bg-diff-comment-edge"
							/>
							Changed
						</span>
					)}
					<PullRequestDiffStatsBadge
						additions={file.additions}
						deletions={file.deletions}
					/>
				</Button>
				{canMarkViewed && (
					<Toggle
						aria-label={`Mark ${path} viewed`}
						className="h-7 cursor-pointer gap-1.5 px-2"
						disabled={isViewedPending}
						onPressedChange={handleToggleViewed}
						pressed={isViewed}
						size="sm"
						variant="outline"
					>
						<span
							className={cn(
								'flex size-3.5 items-center justify-center rounded-[3px] border border-muted-foreground/60',
								isViewed && 'border-primary bg-primary text-primary-foreground'
							)}
						>
							<Check
								className={cn(
									'size-2.5 transition-opacity duration-[120ms] ease-out',
									isViewed ? 'opacity-100' : 'opacity-0'
								)}
								strokeWidth={3}
							/>
						</span>
						<span className="text-xs">Viewed</span>
					</Toggle>
				)}
			</div>
			{!isExpanded && isLargeChangedFile(file) && (
				<div className="flex items-center justify-between gap-3 px-3 py-2">
					<p className="text-muted-foreground text-xs">
						{file.isBinary
							? 'Binary file.'
							: `Large diff — ${file.additions + file.deletions} changed lines.`}
					</p>
					<Button
						aria-label={`Load diff for ${path}`}
						onClick={handleToggleExpanded}
						size="sm"
						variant="outline"
					>
						Load diff
					</Button>
				</div>
			)}
			{isExpanded && isMounted && (
				<div
					style={{
						contentVisibility: 'auto',
						containIntrinsicSize: `auto ${toBodyEstimate(file)}px`,
					}}
				>
					{children}
				</div>
			)}
		</div>
	)
}

/** A first guess at the diff's height, which `auto` replaces once it has rendered. */
function toBodyEstimate(file: PullRequestChangedFile): number {
	const rows = Math.max(file.additions, file.deletions) + CONTEXT_ROWS

	return Math.min(rows * DIFF_ROW_HEIGHT, MAX_BODY_ESTIMATE)
}

// A viewed tick moves state on the files view, which renders every other file.
export const PullRequestFileSection = memo(FileSection)
