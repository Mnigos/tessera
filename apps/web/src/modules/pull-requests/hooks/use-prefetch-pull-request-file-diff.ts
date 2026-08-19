import type { GetPullRequestFileDiffInput } from '@repo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { getPullRequestFileDiffQueryOptions } from './use-pull-request-file-diff.query'

export function usePrefetchPullRequestFileDiff() {
	const queryClient = useQueryClient()

	return useCallback(
		(input: GetPullRequestFileDiffInput) =>
			queryClient.prefetchQuery(getPullRequestFileDiffQueryOptions(input)),
		[queryClient]
	)
}
