import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useUpdateOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.update.mutationOptions({
			onSuccess: async () => {
				// Both keys: a rename changes the handle the list renders and the
				// record the settings page is reading.
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
