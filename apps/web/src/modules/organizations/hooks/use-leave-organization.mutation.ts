import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useLeaveOrganizationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.leave.mutationOptions({
			onSuccess: async (_result, { organizationId }) => {
				// Dropped, not invalidated: the page reading these is still mounted.
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.get.queryKey({
						input: { organizationId },
					}),
				})
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.listMembers.queryKey({
						input: { organizationId },
					}),
				})
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.listInvitations.queryKey({
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
