import {
	type RepositorySyncHealthFacts,
	toRepositorySyncHealth,
} from './repository-sync-health'

const now = new Date('2026-08-11T12:00:00Z')
const options = { now, syncIntervalMinutes: 60 }

function facts(
	overrides: Partial<RepositorySyncHealthFacts> = {}
): RepositorySyncHealthFacts {
	return {
		syncStatus: 'succeeded',
		lastSyncSucceededAt: new Date('2026-08-11T11:50:00Z'),
		pendingDeliveryCount: 0,
		retryCount24h: 0,
		terminalCount24h: 0,
		completedCount24h: 0,
		latestAttemptStatus: 'succeeded',
		...overrides,
	}
}

describe('toRepositorySyncHealth', () => {
	test('reports a converged mirror as healthy', () => {
		expect(toRepositorySyncHealth(facts(), options)).toMatchObject({
			state: 'healthy',
			freshnessLagSeconds: 600,
			pendingDeliveryCount: 0,
			failureRate24h: 0,
			reauthorizationRequired: false,
		})
	})

	// Every mirror that existed before attempts were recorded has no rows, and so
	// does every mirror for the first run after this ships. Reading that absence
	// as unhealthy would block cutover for all of them at once, so the attempt
	// history enriches health rather than gating it.
	test('reports a mirror with no recorded attempts as healthy', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					latestAttemptStatus: undefined,
					lastReconciliationDurationMs: undefined,
					completedCount24h: 0,
				}),
				options
			)
		).toMatchObject({
			state: 'healthy',
			retryCount24h: 0,
			failureRate24h: 0,
			lastReconciliationDurationMs: undefined,
		})
	})

	// The two facts the web copy has to stay honest about: `pending` covers a run
	// that is already going, and `partial` covers a clean run a newer delivery has
	// outlived. Neither may be described as merely queued or as a failed run.
	test('reports a running sync as pending, not as merely queued work', () => {
		expect(
			toRepositorySyncHealth(
				facts({ syncStatus: 'running', latestAttemptStatus: 'running' }),
				options
			)
		).toMatchObject({ state: 'pending' })
	})

	test('reports a clean run with a newer delivery as partial', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'succeeded',
					latestAttemptStatus: 'succeeded',
					pendingDeliveryCount: 1,
				}),
				options
			)
		).toMatchObject({ state: 'partial' })
	})

	test('reports a run that finalized incompletely as partial', () => {
		expect(
			toRepositorySyncHealth(facts({ latestAttemptStatus: 'partial' }), options)
		).toMatchObject({ state: 'partial' })
	})

	test('reports deliveries a finished run left behind as partial', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					pendingDeliveryCount: 3,
					oldestPendingDeliveryAt: new Date('2026-08-11T11:40:00Z'),
				}),
				options
			)
		).toMatchObject({
			state: 'partial',
			pendingDeliveryCount: 3,
			deliveryLagSeconds: 1200,
		})
	})

	test('reports a mirror past two intervals without success as stale', () => {
		expect(
			toRepositorySyncHealth(
				facts({ lastSyncSucceededAt: new Date('2026-08-11T09:30:00Z') }),
				options
			)
		).toMatchObject({ state: 'stale' })
	})

	test('reports a queued run that has gone stale as stale rather than pending', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'pending',
					lastSyncSucceededAt: new Date('2026-08-11T08:00:00Z'),
				}),
				options
			)
		).toMatchObject({ state: 'stale' })
	})

	test('reports a mirror that has never run as pending, not stale', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'pending',
					lastSyncSucceededAt: undefined,
					latestAttemptStatus: undefined,
				}),
				options
			)
		).toMatchObject({ state: 'pending', freshnessLagSeconds: undefined })
	})

	test('surfaces a failure with its safe code and message', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'failed',
					syncFailureCode: 'upstream_unavailable',
					syncFailureReason: 'GitHub could not be reached.',
					latestAttemptStatus: 'retry_scheduled',
				}),
				options
			)
		).toMatchObject({
			state: 'failed',
			code: 'upstream_unavailable',
			message: 'GitHub could not be reached.',
			reauthorizationRequired: false,
		})
	})

	test('asks for reauthorization when a block is about lost access', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'blocked',
					syncFailureCode: 'repository_unavailable',
					latestAttemptStatus: 'blocked',
				}),
				options
			)
		).toMatchObject({ state: 'blocked', reauthorizationRequired: true })
	})

	test('does not ask for reauthorization when a block is not about access', () => {
		expect(
			toRepositorySyncHealth(
				facts({ syncStatus: 'blocked', syncFailureCode: 'missing_storage' }),
				options
			)
		).toMatchObject({ state: 'blocked', reauthorizationRequired: false })
	})

	test('reports a code it does not recognize as a generic failure', () => {
		expect(
			toRepositorySyncHealth(
				facts({ syncStatus: 'failed', syncFailureCode: 'pg_error_23505' }),
				options
			)
		).toMatchObject({ code: 'reconciliation_failed' })
	})

	test('derives retry and failure rates from the attempt window', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					retryCount24h: 6,
					terminalCount24h: 2,
					completedCount24h: 8,
					lastReconciliationDurationMs: 4200,
				}),
				options
			)
		).toMatchObject({
			retryCount24h: 6,
			failureRate24h: 0.25,
			lastReconciliationDurationMs: 4200,
		})
	})

	// The denominator counts operations that reached a verdict, not tries. One
	// operation that retried four times and then failed is a total loss, and
	// reporting it as a twenty-percent failure rate would read as mostly fine.
	test('reports an operation that failed after retries as wholly failed', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'failed',
					retryCount24h: 4,
					terminalCount24h: 1,
					completedCount24h: 1,
					latestAttemptStatus: 'terminal_failed',
				}),
				options
			)
		).toMatchObject({ retryCount24h: 4, failureRate24h: 1 })
	})

	test('reports no failures when nothing has completed in the window', () => {
		expect(
			toRepositorySyncHealth(
				facts({ retryCount24h: 3, terminalCount24h: 0, completedCount24h: 0 }),
				options
			)
		).toMatchObject({ failureRate24h: 0 })
	})

	// A limit is GitHub asking Tessera to wait, with a time attached. The source
	// row can only record it as a failure, but showing a broken mirror for a
	// condition that clears itself on a known schedule would be wrong.
	test('reports an active rate limit as pending rather than failed', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'failed',
					syncFailureCode: 'rate_limited',
					syncFailureReason: 'GitHub is rate limiting this installation.',
					rateLimitedUntil: new Date('2026-08-11T12:30:00Z'),
					latestAttemptStatus: 'retry_scheduled',
				}),
				options
			)
		).toMatchObject({
			state: 'pending',
			code: 'rate_limited',
			rateLimitedUntil: new Date('2026-08-11T12:30:00Z'),
		})
	})

	test('reports a rate limit outlasting the freshness window as stale', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'failed',
					syncFailureCode: 'rate_limited',
					lastSyncSucceededAt: new Date('2026-08-11T08:00:00Z'),
					rateLimitedUntil: new Date('2026-08-11T12:30:00Z'),
				}),
				options
			)
		).toMatchObject({ state: 'stale', code: 'rate_limited' })
	})

	test('reports a failure again once its rate limit has passed', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'failed',
					syncFailureCode: 'rate_limited',
					rateLimitedUntil: new Date('2026-08-11T11:00:00Z'),
				}),
				options
			)
		).toMatchObject({ state: 'failed' })
	})

	test('keeps a blocked repository blocked even while rate limited', () => {
		expect(
			toRepositorySyncHealth(
				facts({
					syncStatus: 'blocked',
					syncFailureCode: 'missing_installation',
					rateLimitedUntil: new Date('2026-08-11T12:30:00Z'),
				}),
				options
			)
		).toMatchObject({ state: 'blocked', reauthorizationRequired: true })
	})

	test('shows a rate-limit deferral only while it is still in force', () => {
		expect(
			toRepositorySyncHealth(
				facts({ rateLimitedUntil: new Date('2026-08-11T12:30:00Z') }),
				options
			)
		).toMatchObject({ rateLimitedUntil: new Date('2026-08-11T12:30:00Z') })
		expect(
			toRepositorySyncHealth(
				facts({ rateLimitedUntil: new Date('2026-08-11T11:00:00Z') }),
				options
			)
		).toMatchObject({ rateLimitedUntil: undefined })
	})
})
