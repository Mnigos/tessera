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
	)('reads a rate-limited %s state as waiting, never as broken', state => {
		const presentation = getRepositorySyncHealthPresentation(
			syncHealth({ state, code: 'rate_limited' })
		)

		expect(presentation.label).toBe('Waiting on GitHub')
		expect(presentation.description).toContain('resumes on its own')
		expect(presentation.iconClassName).not.toContain('rose')
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
