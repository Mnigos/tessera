import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryBrowserSummaryQuery(
	username: string,
	slug: string
) {
	return useQuery(
		orpcQuery.repositories.getBrowserSummary.queryOptions({
			input: { username, slug },
		})
	)
}
