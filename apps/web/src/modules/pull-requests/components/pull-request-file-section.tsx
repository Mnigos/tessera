import type { PullRequestChangedFile } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Toggle } from '@repo/ui/components/toggle'
import { cn } from '@repo/ui/utils'
import { Check, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { memo, type PropsWithChildren, useCallback } from 'react'
import { isLargeChangedFile } from '../helpers/pull-request-changed-files'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'

const EXPAND_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const
const CHECK_TRANSITION = { duration: 0.15, ease: 'easeOut' } as const

interface PullRequestFileSectionProps extends PropsWithChildren {
	file: PullRequestChangedFile
	path: string
	displayPath: string
	isExpanded: boolean
	isViewed: boolean
	canMarkViewed: boolean
	isViewedPending: boolean
	isNearViewport: boolean
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
	canMarkViewed,
	isViewedPending,
	isNearViewport,
	onToggleExpanded,
	onToggleViewed,
	onPrefetch,
	onRegisterNode,
	children,
}: Readonly<PullRequestFileSectionProps>) {
	const shouldReduceMotion = useReducedMotion()
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

	return (
		<div className="scroll-mt-2" ref={observeSection}>
			<div
				className={cn(
					'overflow-visible rounded-md border border-border bg-card transition-opacity',
					isViewed && 'opacity-60'
				)}
			>
				{/* The header outlives its own diff on screen, so it carries the page background. */}
				<div
					className={cn(
						'sticky top-0 z-10 flex h-10 items-center gap-2 rounded-t-md border-border bg-background pr-2',
						isExpanded && 'border-b'
					)}
				>
					<Button
						aria-expanded={isExpanded}
						className="h-10 min-w-0 flex-1 justify-start gap-2 rounded-none rounded-tl-md px-2 py-0 text-left font-normal"
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
							className="min-w-0 flex-1 truncate font-mono text-xs"
							title={displayPath}
						>
							{displayPath}
						</span>
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
									'flex size-3.5 items-center justify-center rounded-[3px] border border-muted-foreground/60 transition-colors',
									isViewed &&
										'border-primary bg-primary text-primary-foreground'
								)}
							>
								<motion.span
									animate={{
										scale: isViewed ? 1 : 0.4,
										opacity: isViewed ? 1 : 0,
									}}
									className="flex"
									initial={false}
									transition={
										shouldReduceMotion ? { duration: 0 } : CHECK_TRANSITION
									}
								>
									<Check className="size-2.5" strokeWidth={3} />
								</motion.span>
							</span>
							<span className="text-xs">Viewed</span>
						</Toggle>
					)}
				</div>
				{!isExpanded && isLargeChangedFile(file) && (
					<div className="flex items-center justify-between gap-3 border-border border-t px-3 py-2">
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
				<AnimatePresence initial={false}>
					{isExpanded && isNearViewport && (
						<motion.div
							animate={{ height: 'auto', opacity: 1 }}
							className="overflow-hidden rounded-b-md"
							exit={{ height: 0, opacity: 0 }}
							initial={{ height: 0, opacity: 0 }}
							transition={
								shouldReduceMotion ? { duration: 0 } : EXPAND_TRANSITION
							}
						>
							{children}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</div>
	)
}

// A viewed tick moves state on the files view, which renders every other file.
export const PullRequestFileSection = memo(FileSection)
