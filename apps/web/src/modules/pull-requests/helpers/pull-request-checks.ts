import type {
	CheckRollupState,
	CheckState,
	ChecksSummary,
} from '@repo/contracts'
import {
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleMinus,
	CircleSlash,
	CircleX,
	Clock,
	History,
	type LucideIcon,
	TimerOff,
} from 'lucide-react'

export interface CheckStatePresentation {
	label: string
	icon: LucideIcon
	iconClassName: string
}

/**
 * Every state names itself. Colour is the accent, never the message: a reader
 * who cannot tell emerald from rose still reads "Failed".
 */
const CHECK_STATE_PRESENTATIONS: Record<CheckState, CheckStatePresentation> = {
	queued: {
		label: 'Queued',
		icon: Clock,
		iconClassName: 'text-muted-foreground',
	},
	pending: {
		label: 'In progress',
		icon: CircleDashed,
		iconClassName: 'text-amber-400',
	},
	success: {
		label: 'Passed',
		icon: CircleCheck,
		iconClassName: 'text-emerald-400',
	},
	failure: { label: 'Failed', icon: CircleX, iconClassName: 'text-rose-400' },
	neutral: {
		label: 'Neutral',
		icon: CircleDot,
		iconClassName: 'text-muted-foreground',
	},
	canceled: {
		label: 'Canceled',
		icon: CircleSlash,
		iconClassName: 'text-muted-foreground',
	},
	skipped: {
		label: 'Skipped',
		icon: CircleMinus,
		iconClassName: 'text-muted-foreground',
	},
	timed_out: {
		label: 'Timed out',
		icon: TimerOff,
		iconClassName: 'text-rose-400',
	},
	// The provider invalidated this result itself, which is not the same as the
	// pull request having moved past the commit it was computed on.
	stale: { label: 'Stale', icon: History, iconClassName: 'text-amber-400' },
}

const CHECK_ROLLUP_PRESENTATIONS: Record<
	CheckRollupState,
	CheckStatePresentation
> = {
	none: {
		label: 'No checks',
		icon: CircleDashed,
		iconClassName: 'text-muted-foreground',
	},
	pending: {
		label: 'Checks running',
		icon: CircleDashed,
		iconClassName: 'text-amber-400',
	},
	success: {
		label: 'Checks passed',
		icon: CircleCheck,
		iconClassName: 'text-emerald-400',
	},
	failure: {
		label: 'Checks failed',
		icon: CircleX,
		iconClassName: 'text-rose-400',
	},
}

/** Returns the icon, accent, and wording for one check result. */
export function getCheckStatePresentation(state: CheckState) {
	return CHECK_STATE_PRESENTATIONS[state]
}

/** Returns the icon, accent, and wording for a whole commit's rollup. */
export function getCheckRollupPresentation(overall: CheckRollupState) {
	return CHECK_ROLLUP_PRESENTATIONS[overall]
}

/**
 * The count the rollup is actually about: how many failed, or how many are
 * still running, or how many passed. Nothing reported means no count at all.
 */
export function getCheckRollupCount({ counts, overall }: ChecksSummary) {
	if (overall === 'none') return 0

	if (overall === 'failure')
		return counts.failure + counts.canceled + counts.timed_out + counts.stale

	if (overall === 'pending') return counts.queued + counts.pending

	return counts.success + counts.neutral + counts.skipped
}

/** Reads a rollup out loud, for a badge that would otherwise be an icon and a number. */
export function getCheckRollupDescription(summary: ChecksSummary) {
	const count = getCheckRollupCount(summary)
	const checks = count === 1 ? 'check' : 'checks'

	if (summary.overall === 'none') return 'No checks have reported'

	if (summary.overall === 'failure') return `${count} ${checks} failed`

	if (summary.overall === 'pending') return `${count} ${checks} running`

	return `${count} ${checks} passed`
}

/**
 * Formats how long a check took, coarsely — a run's duration is context for
 * scanning a list, not a measurement anyone acts on to the millisecond.
 */
export function formatCheckDuration(durationMs?: number) {
	if (durationMs === undefined) return undefined

	const seconds = Math.round(durationMs / 1000)

	if (seconds < 60) return `${seconds}s`

	const minutes = Math.floor(seconds / 60)

	if (minutes < 60) return `${minutes}m ${seconds % 60}s`

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
