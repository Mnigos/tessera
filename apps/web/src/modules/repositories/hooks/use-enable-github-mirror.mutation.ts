import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * An imported snapshot becomes a mirror GitHub owns: the remotes move to
 * GitHub, and there is a synchronization to report on where there was none.
 */
function getEnableMirrorInvalidatedQueryKeys() {
	return [
		orpcQuery.repositories.get.key(),
		orpcQuery.repositories.list.key(),
		orpcQuery.repositories.getBrowserSummary.key(),
		orpcQuery.repositories.getGitHubSyncHealth.key(),
	]
}

export function useEnableGitHubMirrorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.enableGitHubMirror.mutationOptions({
			onSuccess: result => {
				if (result.status === 'installation_required') {
					window.location.assign(result.installUrl)
					return
				}

				// Not awaited: four refetches must not decide when the mutation is
				// reported as done. Callers keep the affordance disabled through
				// `isSuccess` instead, which outlives the settle either way.
				for (const queryKey of getEnableMirrorInvalidatedQueryKeys())
					void queryClient.invalidateQueries({ queryKey })
			},
		})
	)
}
