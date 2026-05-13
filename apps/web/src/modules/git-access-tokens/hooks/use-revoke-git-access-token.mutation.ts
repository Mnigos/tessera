import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRevokeGitAccessTokenMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.gitAccessTokens.revoke.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.gitAccessTokens.list.key(),
				})
			},
		})
	)
}
