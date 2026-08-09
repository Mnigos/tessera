import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateCheckStatusCredentialMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.checks.createStatusCredential.mutationOptions({
			// Not awaited: React Query holds the mutation's own result until a
			// promise returned from here settles, and this mutation's result can be
			// a secret shown exactly once. A slow or rejected refetch must not delay
			// it, let alone lose it.
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: orpcQuery.checks.listStatusProviders.key(),
				})
			},
		})
	)
}
