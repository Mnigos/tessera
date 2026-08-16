import type { OrganizationMembership } from '@repo/contracts'

/**
 * Organizations are addressed by handle in the URL and by id in the API, and
 * the viewer's own membership list is what bridges the two. A handle missing
 * from it means the viewer is not a member, which the settings page answers the
 * same way it answers a handle that does not exist at all.
 */
export function findOrganizationMembership(
	organizations: OrganizationMembership[] | undefined,
	slug: string
) {
	return organizations?.find(organization => organization.slug === slug)
}
