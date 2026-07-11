import type { GetPullRequestInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestComparisonQuery(
	input: GetPullRequestInput,
	enabled = true
) {
	return useQuery(getPullRequestComparisonQueryOptions(input, enabled))
}

export function getPullRequestComparisonQueryOptions(
	input: GetPullRequestInput,
	enabled = true
) {
	return orpcQuery.pullRequests.comparison.queryOptions({
		input,
		enabled,
	})
}
