import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useUpdateOrganizationMemberRoleMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.organizations.updateMemberRole.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.organizations.listMembers.key(),
				})
			},
		})
	)
}
