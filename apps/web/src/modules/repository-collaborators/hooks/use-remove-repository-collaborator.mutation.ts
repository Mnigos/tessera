import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRemoveRepositoryCollaboratorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositoryCollaborators.remove.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.repositoryCollaborators.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.repositories.getBrowserSummary.key(),
					}),
				])
			},
		})
	)
}
