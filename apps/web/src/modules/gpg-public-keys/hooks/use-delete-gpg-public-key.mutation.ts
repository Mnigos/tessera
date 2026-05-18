import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useDeleteGpgPublicKeyMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.gpgPublicKeys.delete.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.gpgPublicKeys.list.key(),
				})
			},
		})
	)
}
