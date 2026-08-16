import type { GetOrganizationInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useOrganizationQuery(
	input: GetOrganizationInput,
	enabled = true
) {
	return useQuery(getOrganizationQueryOptions(input, enabled))
}

export function getOrganizationQueryOptions(
	input: GetOrganizationInput,
	enabled = true
) {
	return orpcQuery.organizations.get.queryOptions({
		input,
		enabled,
	})
}
