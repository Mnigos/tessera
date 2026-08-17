import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'
import { isPullRequestStaleComparisonError } from '../helpers/get-pull-request-error-message'

export function useSetPullRequestFileViewedMutation() {
	const queryClient = useQueryClient()
	const mutationKey = orpcQuery.pullRequests.setFileViewed.mutationKey()

	return useMutation(
		orpcQuery.pullRequests.setFileViewed.mutationOptions({
			mutationKey,
			// The tick lands before the round trip so the file collapses under the pointer.
			onMutate: async ({ path, viewed, ...input }) => {
				const queryKey = orpcQuery.pullRequests.listViewedFiles.queryKey({
					input,
				})

				await queryClient.cancelQueries({ queryKey })

				const previous = queryClient.getQueryData(queryKey)

				queryClient.setQueryData(
					queryKey,
					viewedFiles =>
						viewedFiles && {
							...viewedFiles,
							paths: viewed
								? [...new Set([...viewedFiles.paths, path])]
								: viewedFiles.paths.filter(viewedPath => viewedPath !== path),
						}
				)

				return { queryKey, previous }
			},
			// A rejected head means the ticked diff is gone, so the files view reloads.
			onError: async (error, { username, slug, number }, context) => {
				if (context)
					queryClient.setQueryData(context.queryKey, context.previous)

				if (!isPullRequestStaleComparisonError(error)) return

				await queryClient.invalidateQueries({
					queryKey: orpcQuery.pullRequests.comparison.key({
						input: { username, slug, number },
					}),
				})
			},
			// Only the last toggle still in flight refetches, so a slower one is not clobbered.
			onSettled: async () => {
				if (queryClient.isMutating({ mutationKey }) > 1) return

				await queryClient.invalidateQueries({
					queryKey: orpcQuery.pullRequests.listViewedFiles.key(),
				})
			},
		})
	)
}
