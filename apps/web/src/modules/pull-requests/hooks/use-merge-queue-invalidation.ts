import { useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * Every queue action changes both where the pull request stands and what the
 * merge panel may offer, so the detail and the requirements are refreshed
 * together rather than leaving one of them describing the previous state.
 */
export function useMergeQueueInvalidation() {
	const queryClient = useQueryClient()

	return async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: orpcQuery.pullRequests.get.key(),
			}),
			queryClient.invalidateQueries({
				queryKey: orpcQuery.pullRequests.getMergeRequirements.key(),
			}),
		])
	}
}
