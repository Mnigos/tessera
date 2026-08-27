import type {
	RepositorySyncHealth,
	RepositorySyncHealthCode,
	RepositorySyncHealthState,
} from '@repo/contracts'
import { repositorySyncHealthCodeSchema } from '@repo/contracts'
import type { GitHubSyncAttemptStatus, RepositorySyncProgress } from '@repo/db'

/**
 * A mirror is stale once it has gone this many reconciliation intervals without
 * a successful run. One missed interval is a slow dispatcher tick or a run that
 * is still going; two is something not recovering on its own.
 */
const STALE_INTERVAL_MULTIPLIER = 2
const MILLISECONDS_PER_SECOND = 1000

/**
 * The codes that describe access Tessera no longer has, which is the only kind
 * of block a person can clear — by granting the GitHub App access again.
 * Storage being unavailable is also a block, and reauthorizing would do nothing
 * for it.
 */
const REAUTHORIZABLE_CODES: ReadonlySet<RepositorySyncHealthCode> = new Set([
	'missing_installation',
	'installation_suspended',
	'authentication_failed',
	'authorization_failed',
	'repository_unavailable',
])

/** A run heartbeats progress far more often than this; silence this long is death. */
const STALE_PROGRESS_MS = 3 * 60 * 1000

export interface RepositorySyncHealthFacts {
	syncStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked'
	syncProgress?: RepositorySyncProgress
	lastSyncSucceededAt?: Date
	syncFailureCode?: string
	syncFailureReason?: string
	rateLimitedUntil?: Date
	pendingDeliveryCount: number
	oldestPendingDeliveryAt?: Date
	retryCount24h: number
	terminalCount24h: number
	completedCount24h: number
	latestAttemptStatus?: GitHubSyncAttemptStatus
	lastReconciliationDurationMs?: number
}

/**
 * Turns what the database knows into what a reader is told.
 *
 * Nothing here is persisted: `stale` compares the last success against the
 * cadence the mirror is supposed to keep, and `partial` comes from the last
 * attempt having finalized incompletely or from deliveries a finished run left
 * behind. Both mean the mirror is not converged, which is why cutover asks for
 * `healthy` rather than for the source's own `succeeded`.
 */
export function toRepositorySyncHealth(
	facts: RepositorySyncHealthFacts,
	{ now, syncIntervalMinutes }: { now: Date; syncIntervalMinutes: number }
): RepositorySyncHealth {
	const code = toSyncHealthCode(facts.syncFailureCode)
	const state = toSyncHealthState(facts, { now, syncIntervalMinutes })

	return {
		state,
		// Progress only means something while a run is on the row. A killed
		// worker writes no cleanup, so anything that has not moved in minutes is
		// a leftover, not a run — the row reads as plainly pending instead of as
		// a frozen bar.
		progress:
			state === 'pending' &&
			facts.syncProgress &&
			now.getTime() - Date.parse(facts.syncProgress.updatedAt) <
				STALE_PROGRESS_MS
				? {
						stage: facts.syncProgress.stage,
						current: facts.syncProgress.current,
						total: facts.syncProgress.total,
					}
				: undefined,
		freshnessLagSeconds: toLagSeconds(facts.lastSyncSucceededAt, now),
		deliveryLagSeconds: toLagSeconds(facts.oldestPendingDeliveryAt, now),
		pendingDeliveryCount: facts.pendingDeliveryCount,
		retryCount24h: facts.retryCount24h,
		failureRate24h:
			facts.completedCount24h > 0
				? facts.terminalCount24h / facts.completedCount24h
				: 0,
		lastReconciliationDurationMs: facts.lastReconciliationDurationMs,
		rateLimitedUntil:
			facts.rateLimitedUntil && facts.rateLimitedUntil > now
				? facts.rateLimitedUntil
				: undefined,
		code,
		message: facts.syncFailureReason,
		reauthorizationRequired:
			state === 'blocked' && Boolean(code && REAUTHORIZABLE_CODES.has(code)),
	}
}

function toSyncHealthState(
	{
		lastSyncSucceededAt,
		latestAttemptStatus,
		pendingDeliveryCount,
		rateLimitedUntil,
		syncStatus,
	}: RepositorySyncHealthFacts,
	{ now, syncIntervalMinutes }: { now: Date; syncIntervalMinutes: number }
): RepositorySyncHealthState {
	if (syncStatus === 'blocked') return 'blocked'

	const isOverdue = isStale(lastSyncSucceededAt, { now, syncIntervalMinutes })

	// Being rate limited is GitHub asking Tessera to wait, with a time attached.
	// The source row records it as a failure because that is the only status it
	// has for "the run did not finish", but reporting a broken mirror for a
	// condition that clears itself on a known schedule would be wrong.
	if (rateLimitedUntil && rateLimitedUntil > now)
		return isOverdue ? 'stale' : 'pending'

	if (syncStatus === 'failed') return 'failed'

	// Staleness outranks work being queued, because a mirror that has been
	// pending for hours is exactly the case a queued state would hide.
	if (isOverdue) return 'stale'
	if (syncStatus !== 'succeeded') return 'pending'

	// Deliveries outliving the run that should have consumed them say the same
	// thing a contained stage failure does: the snapshot is not whole yet.
	if (latestAttemptStatus === 'partial' || pendingDeliveryCount > 0)
		return 'partial'

	return 'healthy'
}

/** A mirror that has never succeeded is starting, not stale. */
function isStale(
	lastSyncSucceededAt: Date | undefined,
	{ now, syncIntervalMinutes }: { now: Date; syncIntervalMinutes: number }
): boolean {
	if (!lastSyncSucceededAt) return false

	const staleAfterMs =
		syncIntervalMinutes *
		STALE_INTERVAL_MULTIPLIER *
		60 *
		MILLISECONDS_PER_SECOND

	return now.getTime() - lastSyncSucceededAt.getTime() > staleAfterMs
}

/**
 * Every code the pipeline writes is already Tessera's own, but the read model
 * is a public boundary: one that has not been declared is reported as a generic
 * failure rather than passed through.
 */
function toSyncHealthCode(
	failureCode: string | undefined
): RepositorySyncHealthCode | undefined {
	if (!failureCode) return undefined

	const parsed = repositorySyncHealthCodeSchema.safeParse(failureCode)

	return parsed.success ? parsed.data : 'reconciliation_failed'
}

function toLagSeconds(since: Date | undefined, now: Date): number | undefined {
	if (!since) return undefined

	return Math.max(
		0,
		Math.floor((now.getTime() - since.getTime()) / MILLISECONDS_PER_SECOND)
	)
}
