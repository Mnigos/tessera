import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateGpgPublicKeyMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.gpgPublicKeys.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.gpgPublicKeys.list.key(),
				})
			},
		})
	)
}
