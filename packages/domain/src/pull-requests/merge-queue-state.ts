/**
 * `completed` is a merged entry and `removed` is an abandoned one: collapsing
 * both into `removed` would make queue history unreadable. The first four states
 * are the active set — an entry in any of them still belongs to the queue.
 */
export const mergeQueueStates = [
	'queued',
	'validating',
	'merging',
	'paused',
	'removed',
	'completed',
] as const

export type MergeQueueState = (typeof mergeQueueStates)[number]
