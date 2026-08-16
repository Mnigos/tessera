import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useAcceptOrganizationInvitationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.acceptInvitation.mutationOptions({
			onSuccess: async (_result, { invitationId }) => {
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.getMyInvitation.queryKey({
						input: { invitationId },
					}),
				})
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.organizations.listMyInvitations.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.organizations.list.key(),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.organizations.listMembers.key(),
					}),
				])
			},
		})
	)
}
