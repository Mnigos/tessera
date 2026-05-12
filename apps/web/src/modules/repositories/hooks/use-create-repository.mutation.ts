import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateRepositoryMutation(username: string) {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositories.list.key({ input: { username } }),
				})
			},
		})
	)
}
