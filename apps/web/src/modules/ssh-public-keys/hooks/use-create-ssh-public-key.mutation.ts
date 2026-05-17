import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateSshPublicKeyMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.sshPublicKeys.create.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.sshPublicKeys.list.key(),
				})
			},
		})
	)
}
