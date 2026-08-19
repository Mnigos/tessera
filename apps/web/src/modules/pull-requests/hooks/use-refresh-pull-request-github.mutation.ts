import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/** Only the cursor is reloaded: the refresh queues a run, the poll reports it. */
export function useRefreshPullRequestGitHubMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.refreshGitHub.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.pullRequests.activity.key(),
				})
			},
		})
	)
}
