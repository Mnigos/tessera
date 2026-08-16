import type { ListRepositoriesInput } from '@repo/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateRepositoryMutation(input: ListRepositoriesInput) {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.create.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: orpcQuery.repositories.list.key({ input }),
					}),
					queryClient.invalidateQueries({
						queryKey: orpcQuery.handles.get.key({
							input: { handle: input.username },
						}),
					}),
				])
			},
		})
	)
}
