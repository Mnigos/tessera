import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useMergePullRequestMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.merge.mutationOptions({
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
				])
			},
		})
	)
}
