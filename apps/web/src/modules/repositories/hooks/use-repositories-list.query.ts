import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoriesListQuery(username: string, enabled: boolean) {
	return useQuery(
		orpcQuery.repositories.list.queryOptions({
			enabled,
			input: { username },
		})
	)
}
