import type { ListPullRequestsInput } from '@repo/contracts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestsListQuery(input: ListPullRequestsInput) {
	return useQuery(getPullRequestsListQueryOptions(input))
}

export function getPullRequestsListQueryOptions(input: ListPullRequestsInput) {
	return orpcQuery.pullRequests.list.queryOptions({
		input,
		placeholderData: keepPreviousData,
	})
}
