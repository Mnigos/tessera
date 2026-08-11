import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * Everything that changes when Tessera takes over. The clone remotes switch
 * away from GitHub, provenance becomes historical, and synchronization stops
 * having a health to report at all.
 */
function getCutoverInvalidatedQueryKeys() {
	return [
		orpcQuery.repositories.get.key(),
		orpcQuery.repositories.list.key(),
		orpcQuery.repositories.getBrowserSummary.key(),
		orpcQuery.repositories.getGitHubSyncHealth.key(),
		orpcQuery.repositories.getGitHubReauthorization.key(),
		orpcQuery.pullRequests.get.key(),
		orpcQuery.pullRequests.list.key(),
	]
}

export function useCutoverGitHubMirrorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.cutoverGitHubMirror.mutationOptions({
			// Not awaited: React Query holds the mutation's own result until a
			// promise returned from here settles, and the confirmation the owner is
			// waiting on must not be gated behind seven refetches.
			onSuccess: () => {
				for (const queryKey of getCutoverInvalidatedQueryKeys())
					void queryClient.invalidateQueries({ queryKey })
			},
		})
	)
}
