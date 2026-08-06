import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useEditPullRequestCommentMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.editComment.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.pullRequests.listThreads.key(),
				})
			},
		})
	)
}
