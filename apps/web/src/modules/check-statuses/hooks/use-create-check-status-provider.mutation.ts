import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateCheckStatusProviderMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.checks.createStatusProvider.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.checks.listStatusProviders.key(),
				})
			},
		})
	)
}
