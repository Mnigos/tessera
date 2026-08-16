import type { GetOrganizationInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useOrganizationQuery(input: GetOrganizationInput) {
	return useQuery(getOrganizationQueryOptions(input))
}

export function getOrganizationQueryOptions(input: GetOrganizationInput) {
	return orpcQuery.organizations.get.queryOptions({ input })
}
