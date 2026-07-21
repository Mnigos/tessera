import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRemoveRepositoryCollaboratorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositoryCollaborators.remove.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositoryCollaborators.list.key(),
				})
			},
		})
	)
}
