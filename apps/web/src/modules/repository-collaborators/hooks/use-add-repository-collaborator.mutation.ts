import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useAddRepositoryCollaboratorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositoryCollaborators.add.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositoryCollaborators.list.key(),
				})
			},
		})
	)
}
