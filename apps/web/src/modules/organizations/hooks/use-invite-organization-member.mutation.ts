import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useInviteOrganizationMemberMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.invite.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listInvitations.key(),
				})
			},
		})
	)
}
