import type { PullRequestChangedFile } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Toggle } from '@repo/ui/components/toggle'
import { cn } from '@repo/ui/utils'
import { Check, ChevronRight, FileCode2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { PropsWithChildren } from 'react'
import { isLargeChangedFile } from '../helpers/pull-request-changed-files'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'

const EXPAND_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const

interface PullRequestFileSectionProps extends PropsWithChildren {
	file: PullRequestChangedFile
	path: string
	displayPath: string
	isExpanded: boolean
	isViewed: boolean
	canMarkViewed: boolean
	isViewedPending: boolean
	isNearViewport: boolean
	onToggleExpanded: () => void
	onToggleViewed: () => void
	onPrefetch: () => void
	onRegisterNode: (node: HTMLElement | null) => void
}

export function PullRequestFileSection({
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

	function observeSection(node: HTMLDivElement | null) {
		if (!node) return

		onRegisterNode(node)

		return () => onRegisterNode(null)
	}

	return (
		<div className="scroll-mt-6" ref={observeSection}>
			<Card
				className={cn(
					'gap-0 overflow-hidden p-0 transition-opacity',
					isViewed && 'opacity-60'
				)}
			>
				<div className="flex items-center gap-2 pr-3">
					<Button
						aria-expanded={isExpanded}
						className="h-auto min-w-0 flex-1 justify-start rounded-none px-4 py-3 text-left"
						onClick={onToggleExpanded}
						onFocus={onPrefetch}
						onPointerEnter={onPrefetch}
						variant="ghost"
					>
						<ChevronRight
							className={cn(
								'size-4 shrink-0 transition-transform',
								isExpanded && 'rotate-90'
							)}
						/>
						<FileCode2 className="size-4 shrink-0 text-muted-foreground" />
						<span
							className="min-w-0 flex-1 truncate font-mono text-xs"
							title={displayPath}
						>
							{displayPath}
						</span>
						<span className="shrink-0 text-muted-foreground text-xs capitalize">
							{file.status}
						</span>
						<PullRequestDiffStatsBadge
							additions={file.additions}
							deletions={file.deletions}
						/>
					</Button>
					{canMarkViewed && (
						<Toggle
							aria-label={`Mark ${path} viewed`}
							disabled={isViewedPending}
							onPressedChange={onToggleViewed}
							pressed={isViewed}
							size="sm"
							variant="outline"
						>
							<Check className="size-3.5" />
							<span className="text-xs">Viewed</span>
						</Toggle>
					)}
				</div>
				{!isExpanded && isLargeChangedFile(file) && (
					<div className="flex items-center justify-between gap-3 border-border border-t px-4 py-3">
						<p className="text-muted-foreground text-xs">
							{file.isBinary
								? 'Binary file.'
								: `Large diff — ${file.additions + file.deletions} changed lines.`}
						</p>
						<Button
							aria-label={`Load diff for ${path}`}
							onClick={onToggleExpanded}
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
							className="overflow-hidden"
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
			</Card>
		</div>
	)
}
