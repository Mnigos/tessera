import type { ListPullRequestChecksInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * The input carries the commit the caller expects, so the cache key does too: a
 * pull request whose head moves reads a different entry rather than serving the
 * previous head's rows against the new head's rollup.
 */
export function usePullRequestChecksQuery(
	input: ListPullRequestChecksInput,
	enabled = true
) {
	return useQuery(getPullRequestChecksQueryOptions(input, enabled))
}

export function getPullRequestChecksQueryOptions(
	input: ListPullRequestChecksInput,
	enabled = true
) {
	return orpcQuery.pullRequests.listChecks.queryOptions({
		input,
		enabled,
	})
}
