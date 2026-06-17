import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useSyncGitHubMirrorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.syncGitHubMirror.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositories.getBrowserSummary.key(),
				})
			},
		})
	)
}
