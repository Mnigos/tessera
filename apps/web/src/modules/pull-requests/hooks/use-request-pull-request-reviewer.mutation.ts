import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRequestPullRequestReviewerMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.requestReviewer.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.get.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.list.key(),
					}),
				])
			},
		})
	)
}
