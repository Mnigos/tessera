import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCancelOrganizationInvitationMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.cancelInvitation.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listInvitations.key(),
				})
			},
		})
	)
}
