import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useSshPublicKeysListQuery(enabled: boolean) {
	return useQuery(
		orpcQuery.sshPublicKeys.list.queryOptions({
			enabled,
		})
	)
}
