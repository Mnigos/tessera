import type { ListPullRequestsInput } from '@repo/contracts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestsListQuery(input: ListPullRequestsInput) {
	return useQuery(getPullRequestsListQueryOptions(input))
}

export function getPullRequestsListQueryOptions(input: ListPullRequestsInput) {
	return orpcQuery.pullRequests.list.queryOptions({
		input,
		// A filter, sort or page change swaps the whole list. Holding the previous
		// rows until the next ones arrive keeps the surface from collapsing to a
		// skeleton on every keystroke.
		placeholderData: keepPreviousData,
	})
}
