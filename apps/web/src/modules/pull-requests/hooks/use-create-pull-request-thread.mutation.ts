import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreatePullRequestThreadMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.createThread.mutationOptions({
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
