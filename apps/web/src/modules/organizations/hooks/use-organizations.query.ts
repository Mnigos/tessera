import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useOrganizationsQuery(enabled = true) {
	return useQuery(getOrganizationsQueryOptions(enabled))
}

export function getOrganizationsQueryOptions(enabled = true) {
	return orpcQuery.organizations.list.queryOptions({
		enabled,
	})
}
