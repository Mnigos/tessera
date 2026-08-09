import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateCheckStatusCredentialMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.checks.createStatusCredential.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.checks.listStatusProviders.key(),
				})
			},
		})
	)
}
