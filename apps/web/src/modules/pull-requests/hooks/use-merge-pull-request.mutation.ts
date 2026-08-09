import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useMergePullRequestMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.merge.mutationOptions({
			// A refused merge is a success as far as the request goes, and it means
			// the requirements the panel is showing are out of date — the server
			// evaluated them again and may have found more, or fewer.
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.get.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.comparison.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.getMergeRequirements.key(),
					}),
				])
			},
		})
	)
}
