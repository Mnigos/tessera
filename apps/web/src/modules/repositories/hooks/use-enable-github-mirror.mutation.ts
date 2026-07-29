import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useEnableGitHubMirrorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.enableGitHubMirror.mutationOptions({
			onSuccess: async result => {
				if (result.status === 'installation_required') {
					window.location.assign(result.installUrl)
					return
				}

				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositories.getBrowserSummary.key(),
				})
			},
		})
	)
}
