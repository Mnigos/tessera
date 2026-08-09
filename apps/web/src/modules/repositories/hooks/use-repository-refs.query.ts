import type { GetRepositoryRefsInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * The repository's refs. Callers that only need them once something is opened
 * pass `enabled`, so a page that merely offers the choice does not fetch every
 * branch on load.
 */
export function useRepositoryRefsQuery(
	input: GetRepositoryRefsInput,
	enabled = true
) {
	return useQuery(
		orpcQuery.repositories.getRefs.queryOptions({
			input,
			enabled,
		})
	)
}
