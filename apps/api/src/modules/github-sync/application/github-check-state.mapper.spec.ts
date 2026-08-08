import {
	toNativeCheckState,
	toNativeCommitStatusState,
} from './github-check-state.mapper'

describe('GitHub check state mapping', () => {
	test.each([
		['queued', 'queued'],
		['in_progress', 'pending'],
		['pending', 'pending'],
		['requested', 'pending'],
		['waiting', 'pending'],
	] as const)('maps check status %s to %s', (status, state) => {
		expect(toNativeCheckState({ status })).toEqual({ state })
	})

	test.each([
		['success', 'success'],
		['failure', 'failure'],
		['action_required', 'failure'],
		['startup_failure', 'failure'],
		['neutral', 'neutral'],
		['cancelled', 'canceled'],
		['skipped', 'skipped'],
		['timed_out', 'timed_out'],
		['stale', 'stale'],
	] as const)('maps check conclusion %s to %s', (conclusion, state) => {
		expect(toNativeCheckState({ conclusion, status: 'completed' })).toEqual({
			state,
		})
	})

	test('fails closed for completed checks without a recognized conclusion', () => {
		expect(toNativeCheckState({ status: 'completed' })).toEqual({
			state: 'failure',
			unrecognized: 'completed',
		})
		expect(toNativeCheckState({ conclusion: 'future_result' })).toEqual({
			state: 'failure',
			unrecognized: 'future_result',
		})
	})

	test('keeps unknown non-terminal statuses pending', () => {
		expect(toNativeCheckState({ status: 'future_status' })).toEqual({
			state: 'pending',
			unrecognized: 'future_status',
		})
		expect(toNativeCheckState({})).toEqual({ state: 'pending' })
	})

	test.each([
		['pending', 'pending'],
		['success', 'success'],
		['failure', 'failure'],
		['error', 'failure'],
	] as const)('maps commit status %s to %s', (rawState, state) => {
		expect(toNativeCommitStatusState(rawState)).toEqual({ state })
	})

	test('fails closed for an unknown commit status', () => {
		expect(toNativeCommitStatusState('future_status')).toEqual({
			state: 'failure',
			unrecognized: 'future_status',
		})
	})
})
