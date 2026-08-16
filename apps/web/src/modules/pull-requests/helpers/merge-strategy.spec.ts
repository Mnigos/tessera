import type { MergeStrategyAvailability } from '@repo/contracts'
import {
	GITHUB_MERGE_STRATEGY_ORDER,
	resolveMergeStrategy,
} from './merge-strategy'

const ALL_AVAILABLE: MergeStrategyAvailability[] = [
	{ strategy: 'merge_commit', available: true },
	{ strategy: 'squash', available: true },
	{ strategy: 'rebase', available: true },
	{ strategy: 'fast_forward', available: true },
]

describe(resolveMergeStrategy.name, () => {
	test('leaves a selection the branches can still take', () => {
		expect(resolveMergeStrategy('rebase', ALL_AVAILABLE)).toBe('rebase')
	})

	// The panel must never present a button that is certain to be refused, so a
	// selection the branches have made impossible gives way on the next render.
	test('falls back to the first method that is still available', () => {
		expect(
			resolveMergeStrategy('fast_forward', [
				{
					strategy: 'merge_commit',
					available: false,
					reason: 'conflict',
				},
				{ strategy: 'squash', available: true },
				{ strategy: 'rebase', available: true },
				{
					strategy: 'fast_forward',
					available: false,
					reason: 'not_fast_forward',
				},
			])
		).toBe('squash')
	})

	test('falls back within the active list when the selection is not offered on GitHub', () => {
		expect(
			resolveMergeStrategy(
				'fast_forward',
				undefined,
				GITHUB_MERGE_STRATEGY_ORDER
			)
		).toBe('merge_commit')
	})

	test('skips an unavailable method that the active list still lists', () => {
		expect(
			resolveMergeStrategy(
				'fast_forward',
				[
					{
						strategy: 'merge_commit',
						available: false,
						reason: 'conflict',
					},
					{ strategy: 'squash', available: true },
				],
				GITHUB_MERGE_STRATEGY_ORDER
			)
		).toBe('squash')
	})

	// With nothing available there is nothing to fall back to, and moving the
	// selection would only hide which method the reader asked for.
	test('keeps the selection when no method is available', () => {
		expect(
			resolveMergeStrategy(
				'rebase',
				ALL_AVAILABLE.map(entry => ({
					...entry,
					available: false,
					reason: 'conflict' as const,
				}))
			)
		).toBe('rebase')
	})

	// A pull request Tessera cannot merge, or one the requirements have not
	// answered for yet, reports nothing — and nothing contradicts the selection.
	test('keeps the selection while availability is unknown', () => {
		expect(resolveMergeStrategy('fast_forward', undefined)).toBe('fast_forward')
		expect(resolveMergeStrategy('fast_forward', [])).toBe('fast_forward')
	})

	test('keeps a selection no entry mentions', () => {
		expect(
			resolveMergeStrategy('rebase', [
				{ strategy: 'merge_commit', available: true },
			])
		).toBe('rebase')
	})
})

describe('GitHub merge strategy order', () => {
	test('keeps GitHub-supported methods in product order', () => {
		expect(GITHUB_MERGE_STRATEGY_ORDER).toEqual([
			'merge_commit',
			'squash',
			'rebase',
		])
		expect(GITHUB_MERGE_STRATEGY_ORDER).not.toContain('fast_forward')
	})
})
