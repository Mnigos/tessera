import {
	type MergeBlockingReason,
	type MergeQueuePauseReason,
	mergeQueuePauseReasonSchema,
} from '@repo/contracts'
import type { MergeQueueBlockingReasonSnapshot } from '@repo/db'

/**
 * The reasons an evaluation produced, as an entry stores them.
 *
 * `queue_paused` is dropped rather than nested: it is what the queue tells
 * everybody else about this entry, and an entry that answers "I am paused"
 * when asked why it is paused says nothing at all. The worker suppresses its
 * own entry while evaluating, so one never reaches here in practice.
 */
export function toMergeQueuePauseReasons(
	reasons: MergeBlockingReason[]
): MergeQueueBlockingReasonSnapshot[] {
	return reasons.flatMap(reason =>
		reason.code === 'queue_paused' ? [] : [{ ...reason }]
	)
}

/**
 * Reads back the reasons stored against a paused queue entry.
 *
 * The row keeps whole reasons — details and all — while the schema types only
 * their codes, because the shape of the details belongs to the API contract.
 * That makes this the parse step, and anything the current contract cannot
 * account for is left out rather than reported half-formed.
 */
export function toMergeQueueBlockingReasons(
	blockingReasons: MergeQueueBlockingReasonSnapshot[] | null
): MergeQueuePauseReason[] | undefined {
	if (!blockingReasons) return undefined

	return blockingReasons.flatMap(reason => {
		const parsed = mergeQueuePauseReasonSchema.safeParse(reason)

		return parsed.success ? [parsed.data] : []
	})
}
