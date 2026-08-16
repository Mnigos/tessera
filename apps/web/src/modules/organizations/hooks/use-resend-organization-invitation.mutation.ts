import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useResendOrganizationInvitationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.resendInvitation.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listInvitations.key(),
				})
			},
		})
	)
}
