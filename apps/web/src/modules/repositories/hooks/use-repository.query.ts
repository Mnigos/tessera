import type { GetRepositoryInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryQuery(input: GetRepositoryInput) {
	return useQuery(
		orpcQuery.repositories.get.queryOptions({
			input,
		})
	)
}
