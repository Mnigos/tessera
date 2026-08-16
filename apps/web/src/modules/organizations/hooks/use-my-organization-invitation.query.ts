import type { MyOrganizationInvitationInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useMyOrganizationInvitationQuery(
	input: MyOrganizationInvitationInput,
	enabled = true
) {
	return useQuery(getMyOrganizationInvitationQueryOptions(input, enabled))
}

export function getMyOrganizationInvitationQueryOptions(
	input: MyOrganizationInvitationInput,
	enabled = true
) {
	return orpcQuery.organizations.getMyInvitation.queryOptions({
		input,
		enabled,
	})
}
