import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGitAccessTokensListQuery(enabled: boolean) {
	return useQuery(
		orpcQuery.gitAccessTokens.list.queryOptions({
			enabled,
		})
	)
}
