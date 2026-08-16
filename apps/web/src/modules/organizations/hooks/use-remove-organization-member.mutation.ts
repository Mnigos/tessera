import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRemoveOrganizationMemberMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.removeMember.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listMembers.key(),
				})
			},
		})
	)
}
