import type { GetRepositoryBrowserSummaryInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryBrowserSummaryQuery({
	username,
	slug,
	ref,
}: GetRepositoryBrowserSummaryInput) {
	return useQuery(
		orpcQuery.repositories.getBrowserSummary.queryOptions({
			// The router hashes keys verbatim, so the property order must match the loader's.
			input: { username, slug, ref },
		})
	)
}
