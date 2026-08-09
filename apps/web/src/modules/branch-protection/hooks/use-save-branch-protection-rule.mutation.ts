import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useSaveBranchProtectionRuleMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.branchProtection.save.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.branchProtection.list.key(),
				})
			},
		})
	)
}
