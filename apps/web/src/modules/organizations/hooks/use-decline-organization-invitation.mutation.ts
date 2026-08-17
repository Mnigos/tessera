import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useDeclineOrganizationInvitationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.declineInvitation.mutationOptions({
			onSuccess: async (_result, { invitationId }) => {
				queryClient.removeQueries({
					queryKey: orpcQuery.organizations.getMyInvitation.queryKey({
						input: { invitationId },
					}),
				})
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listMyInvitations.key(),
				})
			},
		})
	)
}
