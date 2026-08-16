import type { ListOrganizationMembersInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useOrganizationMembersQuery(
	input: ListOrganizationMembersInput,
	enabled = true
) {
	return useQuery(getOrganizationMembersQueryOptions(input, enabled))
}

export function getOrganizationMembersQueryOptions(
	input: ListOrganizationMembersInput,
	enabled = true
) {
	return orpcQuery.organizations.listMembers.queryOptions({ input, enabled })
}
