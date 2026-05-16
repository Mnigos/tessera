import type { ListRepositoriesInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoriesListQuery(
	{ username }: ListRepositoriesInput,
	enabled: boolean
) {
	return useQuery(
		orpcQuery.repositories.list.queryOptions({
			enabled,
			input: { username },
		})
	)
}
