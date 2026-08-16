import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.list.key(),
				})
			},
		})
	)
}
