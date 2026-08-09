import { useMutation } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'
import { useMergeQueueInvalidation } from './use-merge-queue-invalidation'

export function useJoinMergeQueueMutation() {
	const invalidate = useMergeQueueInvalidation()

	return useMutation(
		orpcQuery.pullRequests.joinMergeQueue.mutationOptions({
			onSuccess: invalidate,
		})
	)
}
