import type { OrganizationMember } from '@repo/contracts'

/** An account without a handle is named by whatever it does have. */
export function getOrganizationMemberName({
	displayName,
	username,
}: OrganizationMember['user']): string {
	return username ?? displayName
}
