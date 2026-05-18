import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGpgPublicKeysListQuery(enabled: boolean) {
	return useQuery(
		orpcQuery.gpgPublicKeys.list.queryOptions({
			enabled,
		})
	)
}
