import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCreateGitHubImportMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.githubImport.createImport.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.githubImport.listImports.key(),
				})
			},
		})
	)
}
