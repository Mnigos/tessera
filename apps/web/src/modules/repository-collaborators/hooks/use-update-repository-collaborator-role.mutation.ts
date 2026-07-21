import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useUpdateRepositoryCollaboratorRoleMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositoryCollaborators.updateRole.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositoryCollaborators.list.key(),
				})
			},
		})
	)
}
