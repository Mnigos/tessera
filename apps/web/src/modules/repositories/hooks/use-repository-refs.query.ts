import type { GetRepositoryRefsInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryRefsQuery(input: GetRepositoryRefsInput) {
	return useQuery(
		orpcQuery.repositories.getRefs.queryOptions({
			input,
		})
	)
}
