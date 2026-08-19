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
			onMutate: async ({
				expectedHeadSha,
				number,
				path,
				slug,
				username,
				viewed,
			}) => {
				const queryKey = orpcQuery.pullRequests.listViewedFiles.queryKey({
					input: { username, slug, number, expectedHeadSha },
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
			// A tick keyed to the file's blobs outlives a push, so only a head the
			// server answered from a newer commit still has to reload the diff.
			onSuccess: async (
				{ headSha },
				{ username, slug, number, expectedHeadSha }
			) => {
				if (headSha === expectedHeadSha) return

				await queryClient.invalidateQueries({
					queryKey: orpcQuery.pullRequests.comparison.key({
						input: { username, slug, number },
					}),
				})
			},
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
		})
	)
}
