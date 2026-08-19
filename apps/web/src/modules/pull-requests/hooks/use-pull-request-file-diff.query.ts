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
	{
		expectedBaseSha,
		expectedHeadSha,
		username,
		slug,
		number,
		path,
	}: GetPullRequestFileDiffInput,
	enabled = true
) {
	return orpcQuery.pullRequests.fileDiff.queryOptions({
		// The cache hashes the key verbatim, so every caller must spell it the same way.
		input: { expectedBaseSha, expectedHeadSha, username, slug, number, path },
		enabled,
		// The diff between two shas cannot change, so scrolling back never refetches.
		staleTime: Number.POSITIVE_INFINITY,
	})
}
