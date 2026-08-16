import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useDeleteOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.delete.mutationOptions({
			onSuccess: async (_result, { organizationId }) => {
				// Dropped rather than invalidated: the settings page is still mounted
				// when this runs, and refetching an organization that no longer
				// exists would flash a failure on the way out.
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
