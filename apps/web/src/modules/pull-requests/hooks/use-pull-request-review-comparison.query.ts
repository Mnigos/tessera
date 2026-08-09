import type { GetPullRequestReviewComparisonInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestReviewComparisonQuery(
	input: GetPullRequestReviewComparisonInput,
	enabled = true
) {
	return useQuery(getPullRequestReviewComparisonQueryOptions(input, enabled))
}

export function getPullRequestReviewComparisonQueryOptions(
	input: GetPullRequestReviewComparisonInput,
	enabled = true
) {
	return orpcQuery.pullRequests.reviewComparison.queryOptions({
		input,
		enabled,
	})
}
