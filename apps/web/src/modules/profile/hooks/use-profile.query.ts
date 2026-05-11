import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useProfileQuery(username: string) {
	return useQuery(
		orpcQuery.user.profile.queryOptions({
			input: { username },
		})
	)
}
