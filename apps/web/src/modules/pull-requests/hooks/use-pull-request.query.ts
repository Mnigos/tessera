import type { GetPullRequestInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestQuery(input: GetPullRequestInput) {
	return useQuery(getPullRequestQueryOptions(input))
}

export function getPullRequestQueryOptions(input: GetPullRequestInput) {
	return orpcQuery.pullRequests.get.queryOptions({
		input,
	})
}
