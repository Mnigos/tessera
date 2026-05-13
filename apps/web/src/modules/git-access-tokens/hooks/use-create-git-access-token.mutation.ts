import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateGitAccessTokenMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.gitAccessTokens.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.gitAccessTokens.list.key(),
				})
			},
		})
	)
}
