import type { MergeQueueBlockingReasonSnapshot } from '@repo/db'
import { toMergeQueueBlockingReasons } from './merge-queue-blocking-reasons'

describe('toMergeQueueBlockingReasons', () => {
	test('reads back the reasons an entry was parked for', () => {
		expect(
			toMergeQueueBlockingReasons([
				{ code: 'threads_unresolved', count: 3 },
				{
					code: 'merge_conflict',
					baseSha: 'a'.repeat(40),
					headSha: 'b'.repeat(40),
				},
			])
		).toEqual([
			{ code: 'threads_unresolved', count: 3 },
			{
				code: 'merge_conflict',
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
			},
		])
	})

	// Nothing stored is different from nothing blocking: an entry that was never
	// paused has no snapshot to read, and saying "no reasons" would be a claim the
	// row does not make.
	test('distinguishes an entry with no stored snapshot from an empty one', () => {
		expect(toMergeQueueBlockingReasons(null)).toBeUndefined()
		expect(toMergeQueueBlockingReasons([])).toEqual([])
	})

	// The row keeps whole reasons while the contract types their details, so this
	// is the parse step. A reason the current contract cannot account for is
	// dropped rather than handed on half-formed — the caller sees a shorter list,
	// never a malformed entry.
	test('drops a stored reason the current contract cannot account for', () => {
		expect(
			toMergeQueueBlockingReasons([
				{ code: 'threads_unresolved', count: 2 },
				{ code: 'invented_in_a_later_version' },
			] as MergeQueueBlockingReasonSnapshot[])
		).toEqual([{ code: 'threads_unresolved', count: 2 }])
	})

	test('drops a known code whose details no longer parse', () => {
		expect(
			toMergeQueueBlockingReasons([
				{ code: 'threads_unresolved', count: 'several' },
			] as unknown as MergeQueueBlockingReasonSnapshot[])
		).toEqual([])
	})

	test('keeps a reason that carries no details of its own', () => {
		expect(
			toMergeQueueBlockingReasons([{ code: 'repository_merge_in_progress' }])
		).toEqual([{ code: 'repository_merge_in_progress' }])
	})
})
