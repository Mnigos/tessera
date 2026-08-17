import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useMyOrganizationInvitationsQuery(enabled = true) {
	return useQuery(getMyOrganizationInvitationsQueryOptions(enabled))
}

export function getMyOrganizationInvitationsQueryOptions(enabled = true) {
	return orpcQuery.organizations.listMyInvitations.queryOptions({ enabled })
}
