import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryQuery(username: string, slug: string) {
	return useQuery(
		orpcQuery.repositories.get.queryOptions({
			input: { username, slug },
		})
	)
}
