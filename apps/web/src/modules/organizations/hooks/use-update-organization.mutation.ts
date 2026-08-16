import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useUpdateOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.update.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.organizations.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.organizations.get.key(),
					}),
				])
			},
		})
	)
}
