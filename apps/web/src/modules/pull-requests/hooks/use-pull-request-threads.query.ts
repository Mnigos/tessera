import type { ListPullRequestThreadsInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestThreadsQuery(
	input: ListPullRequestThreadsInput,
	enabled = true
) {
	return useQuery(getPullRequestThreadsQueryOptions(input, enabled))
}

export function getPullRequestThreadsQueryOptions(
	input: ListPullRequestThreadsInput,
	enabled = true
) {
	return orpcQuery.pullRequests.listThreads.queryOptions({
		input,
		enabled,
	})
}
