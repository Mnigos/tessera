import type { OrganizationMember } from '@repo/contracts'

export function getOrganizationMemberName({
	displayName,
	username,
}: OrganizationMember['user']): string {
	return username ?? displayName
}
