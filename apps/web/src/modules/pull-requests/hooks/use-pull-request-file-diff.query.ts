import type { GetPullRequestFileDiffInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestFileDiffQuery(
	input: GetPullRequestFileDiffInput,
	enabled: boolean
) {
	return useQuery(getPullRequestFileDiffQueryOptions(input, enabled))
}

export function getPullRequestFileDiffQueryOptions(
	input: GetPullRequestFileDiffInput,
	enabled = true
) {
	return orpcQuery.pullRequests.fileDiff.queryOptions({
		input,
		enabled,
		// The diff between two shas cannot change, so scrolling back never refetches.
		staleTime: Number.POSITIVE_INFINITY,
	})
}
