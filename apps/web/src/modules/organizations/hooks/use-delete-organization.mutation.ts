import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useDeleteOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.delete.mutationOptions({
			onSuccess: async (_result, { organizationId }) => {
				// Dropped rather than invalidated: the settings page is still mounted,
				// and refetching a deleted organization would flash a failure.
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.get.queryKey({
						input: { organizationId },
					}),
				})
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.list.key(),
				})
			},
		})
	)
}
