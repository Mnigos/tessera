import type { Organization } from '@repo/contracts'
import type { OrganizationId } from '@repo/domain'

interface BetterAuthOrganization {
	id: string
	slug: string
	name: string
	createdAt: Date
}

export function toOrganization({
	id,
	slug,
	name,
	createdAt,
}: BetterAuthOrganization): Organization {
	return { id: id as OrganizationId, slug, name, createdAt }
}
