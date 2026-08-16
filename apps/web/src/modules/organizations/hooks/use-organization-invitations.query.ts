import type { ListOrganizationInvitationsInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useOrganizationInvitationsQuery(
	input: ListOrganizationInvitationsInput,
	enabled = true
) {
	return useQuery(getOrganizationInvitationsQueryOptions(input, enabled))
}

export function getOrganizationInvitationsQueryOptions(
	input: ListOrganizationInvitationsInput,
	enabled = true
) {
	return orpcQuery.organizations.listInvitations.queryOptions({
		input,
		enabled,
	})
}
