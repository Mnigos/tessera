import type { OrganizationMembership } from '@repo/contracts'

export function findOrganizationMembership(
	organizations: OrganizationMembership[] | undefined,
	slug: string
) {
	return organizations?.find(organization => organization.slug === slug)
}
