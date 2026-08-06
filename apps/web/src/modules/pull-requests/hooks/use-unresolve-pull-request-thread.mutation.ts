import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useUnresolvePullRequestThreadMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.unresolveThread.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.listThreads.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.pullRequests.get.key(),
					}),
				])
			},
		})
	)
}
