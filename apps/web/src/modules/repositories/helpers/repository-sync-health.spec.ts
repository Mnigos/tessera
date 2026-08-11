import type {
	RepositorySyncHealth,
	RepositorySyncHealthState,
} from '@repo/contracts'
import {
	formatSyncLag,
	getRepositoryCutoverBlockReason,
	getRepositorySyncHealthPresentation,
} from './repository-sync-health'

const ALL_STATES: RepositorySyncHealthState[] = [
	'healthy',
	'pending',
	'stale',
	'partial',
	'failed',
	'blocked',
]

function syncHealth(
	overrides: Partial<RepositorySyncHealth> & {
		state: RepositorySyncHealthState
	}
): RepositorySyncHealth {
	return {
		pendingDeliveryCount: 0,
		retryCount24h: 0,
		failureRate24h: 0,
		reauthorizationRequired: false,
		...overrides,
	}
}

describe('repository sync health presentation', () => {
	test.each(ALL_STATES)('gives %s a distinct label and description', state => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({ state })
		)

		expect(presentation.label.length).toBeGreaterThan(0)
		expect(presentation.description.length).toBeGreaterThan(0)
	})

	test('never reuses a label between two states', () => {
		const labels = ALL_STATES.map(
			state => getRepositorySyncHealthPresentation(syncHealth({ state })).label
		)

		expect(new Set(labels).size).toBe(ALL_STATES.length)
	})

	test('keeps only a healthy mirror quiet', () => {
		for (const state of ALL_STATES)
			expect(
				getRepositorySyncHealthPresentation(syncHealth({ state })).isQuiet
			).toBe(state === 'healthy')
	})

	test.each(
		ALL_STATES
	)('reads an active rate-limited %s state as waiting, never as broken', state => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({
				state,
				code: 'rate_limited',
				rateLimitedUntil: new Date('2026-06-15T11:00:00.000Z'),
			})
		)

		expect(presentation.label).toBe('Waiting on GitHub')
		expect(presentation.description).toContain('resumes on its own')
		expect(presentation.iconClassName).not.toContain('rose')
	})

	// The API drops `rateLimitedUntil` once the reset passes but keeps the code,
	// so the code alone must not keep the reader waiting on a limit that lifted.
	test('stops reporting a rate limit once its reset has passed', () => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({ state: 'failed', code: 'rate_limited' })
		)

		expect(presentation.label).toBe('Sync failed')
		expect(presentation.description).not.toContain('rate limit')
	})

	test('does not blame GitHub access for a block Tessera caused itself', () => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({
				state: 'blocked',
				code: 'missing_storage',
				reauthorizationRequired: false,
			})
		)

		expect(presentation.description).toBe(
			"This repository's storage is unavailable to Tessera, so nothing can be synchronized."
		)
		expect(presentation.description).not.toContain('GitHub')
	})

	test('names GitHub only when access is what has to be restored', () => {
		expect(
			getRepositorySyncHealthPresentation(
				syncHealth({
					state: 'blocked',
					code: 'installation_suspended',
					reauthorizationRequired: true,
				})
			).description
		).toBe(
			'Tessera can no longer reach this repository on GitHub, so nothing new is arriving.'
		)
	})

	test('stays neutral about a block it cannot attribute', () => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({ state: 'blocked' })
		)

		expect(presentation.description).toBe(
			'Synchronization is stopped, so nothing new is arriving.'
		)
		expect(presentation.description).not.toContain('GitHub')
	})

	// The read model folds queued and running into one state, so the copy may not
	// promise that a run has yet to start.
	test('does not claim queued work has not started', () => {
		expect(
			getRepositorySyncHealthPresentation(syncHealth({ state: 'pending' }))
				.description
		).toBe('Synchronization is queued or in progress.')
	})

	// Partial also covers a clean run that a newer delivery has outlived, so the
	// copy may not blame the last run.
	test('does not blame the last run for outstanding partial work', () => {
		const { description } = getRepositorySyncHealthPresentation(
			syncHealth({ state: 'partial' })
		)

		expect(description).toBe(
			'Some GitHub updates are awaiting reconciliation, so data may be missing here.'
		)
		expect(description).not.toContain('last run')
	})
})

describe('repository cutover block reason', () => {
	test('lets a converged mirror through', () => {
		expect(
			getRepositoryCutoverBlockReason(syncHealth({ state: 'healthy' }))
		).toBeUndefined()
	})

	test.each([
		'pending',
		'stale',
		'partial',
		'failed',
		'blocked',
	] as const)('refuses %s with a reason of its own', state => {
		expect(getRepositoryCutoverBlockReason(syncHealth({ state }))).toBeTruthy()
	})

	test('says a stale mirror is waiting for a fresh sync', () => {
		expect(
			getRepositoryCutoverBlockReason(syncHealth({ state: 'stale' }))
		).toBe('Waiting for a fresh sync. Authority can change once one completes.')
	})

	test('tells the owner to restore access only when access is the problem', () => {
		expect(
			getRepositoryCutoverBlockReason(
				syncHealth({
					state: 'blocked',
					code: 'installation_suspended',
					reauthorizationRequired: true,
				})
			)
		).toContain('Restore access')
		expect(
			getRepositoryCutoverBlockReason(
				syncHealth({ state: 'blocked', code: 'missing_storage' })
			)
		).not.toContain('Restore access')
	})

	test('stops citing a rate limit that has already reset', () => {
		expect(
			getRepositoryCutoverBlockReason(
				syncHealth({ state: 'failed', code: 'rate_limited' })
			)
		).toBe(
			'Synchronization is not completing. Authority can change once a run succeeds.'
		)
	})

	test('refuses rather than assuming health it does not have', () => {
		expect(getRepositoryCutoverBlockReason()).toBeTruthy()
	})
})

describe('sync lag formatting', () => {
	test.each([
		[0, 'less than a minute'],
		[59, 'less than a minute'],
		[60, '1 minute'],
		[7200, '2 hours'],
		[86_400, '1 day'],
		[172_800, '2 days'],
	])('reads %i seconds as %s', (seconds, expected) => {
		expect(formatSyncLag(seconds)).toBe(expected)
	})

	test('has nothing to say about an absent lag', () => {
		expect(formatSyncLag()).toBeUndefined()
	})
})
