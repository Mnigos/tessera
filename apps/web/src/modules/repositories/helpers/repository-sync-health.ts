import type {
	RepositorySyncHealth,
	RepositorySyncHealthState,
} from '@repo/contracts'
import {
	CircleCheck,
	CircleDashed,
	CircleSlash,
	History,
	type LucideIcon,
	TimerReset,
	TriangleAlert,
} from 'lucide-react'

export interface RepositorySyncHealthPresentation {
	label: string
	/** What the state means for the reader, in one sentence they can act on. */
	description: string
	icon: LucideIcon
	iconClassName: string
	/** Whether the state is worth interrupting a reader over. */
	isQuiet: boolean
}

/**
 * Every state names itself, and none of them lies about what the reader is
 * looking at. Colour is the accent, never the message: a reader who cannot tell
 * emerald from rose still reads "Sync failed".
 */
const SYNC_HEALTH_PRESENTATIONS: Record<
	RepositorySyncHealthState,
	RepositorySyncHealthPresentation
> = {
	healthy: {
		label: 'In sync',
		description: 'Everything GitHub has sent has been synchronized.',
		icon: CircleCheck,
		iconClassName: 'text-emerald-400',
		isQuiet: true,
	},
	// The read model folds queued and running work into one state, so the copy
	// covers both rather than promising a run has not started yet.
	pending: {
		label: 'Sync in progress',
		description: 'Synchronization is queued or in progress.',
		icon: CircleDashed,
		iconClassName: 'text-muted-foreground',
		isQuiet: false,
	},
	// Not an error, and not something a person can hurry along: the scheduler
	// picks it back up on its own, so the copy says what is uncertain rather
	// than asking for an action nobody can take.
	stale: {
		label: 'Sync overdue',
		description:
			'Nothing has synchronized recently, so what is shown here may be behind GitHub.',
		icon: History,
		iconClassName: 'text-amber-400',
		isQuiet: false,
	},
	// Partial covers a run that finalized incompletely and a clean run that a
	// newer delivery has since outlived. Blaming the last run would be wrong in
	// the second case, so the copy describes the outstanding work instead.
	partial: {
		label: 'Partly synced',
		description:
			'Some GitHub updates are awaiting reconciliation, so data may be missing here.',
		icon: TriangleAlert,
		iconClassName: 'text-amber-400',
		isQuiet: false,
	},
	failed: {
		label: 'Sync failed',
		description:
			'The last synchronization did not finish. Tessera retries on its own.',
		icon: TriangleAlert,
		iconClassName: 'text-rose-400',
		isQuiet: false,
	},
	// The neutral blocked copy. A block Tessera caused itself — storage being
	// unavailable is one — is not GitHub's doing, so the default names no cause
	// at all and the variants below name the ones that are known.
	blocked: {
		label: 'Sync blocked',
		description: 'Synchronization is stopped, so nothing new is arriving.',
		icon: CircleSlash,
		iconClassName: 'text-rose-400',
		isQuiet: false,
	},
}

/**
 * Blocked states whose cause is known well enough to name.
 *
 * Only a lost grant is GitHub's to restore; `missing_storage` is Tessera's own
 * problem and sending its owner to GitHub's settings would waste their time.
 */
const BLOCKED_PRESENTATION_OVERRIDES: Partial<
	Record<NonNullable<RepositorySyncHealth['code']>, string>
> = {
	missing_storage:
		"This repository's storage is unavailable to Tessera, so nothing can be synchronized.",
}

const REAUTHORIZABLE_BLOCKED_DESCRIPTION =
	'Tessera can no longer reach this repository on GitHub, so nothing new is arriving.'

/**
 * Being rate limited is GitHub asking Tessera to wait, with a time attached. It
 * arrives as whichever state the delay has aged into, but it is a queue rather
 * than a fault, and reporting a broken mirror for a condition that clears
 * itself on a known schedule would send people looking for a problem they do
 * not have.
 */
const RATE_LIMITED_PRESENTATION: RepositorySyncHealthPresentation = {
	label: 'Waiting on GitHub',
	description:
		"GitHub's rate limit is in effect. Synchronization resumes on its own once it resets.",
	icon: TimerReset,
	iconClassName: 'text-muted-foreground',
	isQuiet: false,
}

export function getRepositorySyncHealthPresentation(
	syncHealth: RepositorySyncHealth
): RepositorySyncHealthPresentation {
	// The code outlives the deferral: once the reset passes the API drops
	// `rateLimitedUntil` but keeps `rate_limited`, and a limit that has already
	// expired is no longer what a reader is waiting on.
	if (syncHealth.code === 'rate_limited' && syncHealth.rateLimitedUntil)
		return RATE_LIMITED_PRESENTATION

	const presentation = SYNC_HEALTH_PRESENTATIONS[syncHealth.state]

	if (syncHealth.state !== 'blocked') return presentation

	return { ...presentation, description: toBlockedDescription(syncHealth) }
}

function toBlockedDescription({
	code,
	reauthorizationRequired,
}: RepositorySyncHealth): string {
	const override = code && BLOCKED_PRESENTATION_OVERRIDES[code]

	if (override) return override
	if (reauthorizationRequired) return REAUTHORIZABLE_BLOCKED_DESCRIPTION

	return SYNC_HEALTH_PRESENTATIONS.blocked.description
}

/**
 * Why authority cannot change yet, in the terms of the thing standing in the
 * way. Cutover requires a converged mirror rather than merely a run that
 * finished, so every refusal here names something that resolves on its own —
 * except a lost grant, which is the one a person can actually go and fix.
 */
const CUTOVER_BLOCK_REASONS: Record<
	Exclude<RepositorySyncHealthState, 'healthy'>,
	string
> = {
	pending:
		'Synchronization is queued or in progress. Authority can change once it finishes.',
	stale: 'Waiting for a fresh sync. Authority can change once one completes.',
	partial:
		'Some GitHub updates are still awaiting reconciliation. Authority can change once a run completes cleanly.',
	failed:
		'Synchronization is not completing. Authority can change once a run succeeds.',
	blocked:
		'Synchronization is stopped. Authority can change once it resumes and completes.',
}

const REAUTHORIZABLE_CUTOVER_BLOCK_REASON =
	'Tessera has lost access to this repository on GitHub. Restore access before changing authority.'

const RATE_LIMITED_CUTOVER_BLOCK_REASON =
	"Waiting for GitHub's rate limit to reset. Authority can change once a run completes."

export function getRepositoryCutoverBlockReason(
	syncHealth?: RepositorySyncHealth
) {
	if (!syncHealth) return 'Synchronization health is unavailable right now.'
	if (syncHealth.state === 'healthy') return undefined
	if (syncHealth.code === 'rate_limited' && syncHealth.rateLimitedUntil)
		return RATE_LIMITED_CUTOVER_BLOCK_REASON
	if (syncHealth.state === 'blocked' && syncHealth.reauthorizationRequired)
		return REAUTHORIZABLE_CUTOVER_BLOCK_REASON

	return CUTOVER_BLOCK_REASONS[syncHealth.state]
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86_400

/** Lag as a person would say it, for a value the API gives in seconds. */
export function formatSyncLag(seconds?: number) {
	if (seconds === undefined) return undefined
	if (seconds < SECONDS_PER_MINUTE) return 'less than a minute'

	if (seconds < SECONDS_PER_HOUR) {
		const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

		return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
	}

	if (seconds < SECONDS_PER_DAY) {
		const hours = Math.floor(seconds / SECONDS_PER_HOUR)

		return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
	}

	const days = Math.floor(seconds / SECONDS_PER_DAY)

	return `${days} ${days === 1 ? 'day' : 'days'}`
}
