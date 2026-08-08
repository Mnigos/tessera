import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useSubmitPullRequestReviewMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.submitReview.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.get.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.listThreads.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.list.key(),
					}),
				])
			},
		})
	)
}
