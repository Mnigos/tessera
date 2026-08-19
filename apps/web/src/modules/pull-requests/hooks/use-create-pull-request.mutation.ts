import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreatePullRequestMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.create.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.repositories.getBrowserSummary.key(),
					}),
				])
			},
		})
	)
}
