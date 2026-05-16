import type { GetRepositoryBrowserSummaryInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryBrowserSummaryQuery(
	input: GetRepositoryBrowserSummaryInput
) {
	return useQuery(
		orpcQuery.repositories.getBrowserSummary.queryOptions({
			input,
		})
	)
}
