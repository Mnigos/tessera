import type {
	OrganizationMembership as OrganizationMembershipOutput,
	Organization as OrganizationOutput,
} from '@repo/contracts'
import type { Organization } from '@repo/db'
import type { OrganizationRole } from '@repo/domain'

const LOGO_URL_PROTOCOLS = new Set(['http:', 'https:'])

/** The columns every organization projection needs, whoever is reading it. */
export interface OrganizationView {
	id: Organization['id']
	slug: string
	name: string
	logo: string | null
	createdAt: Date
}

export interface OrganizationMembershipView extends OrganizationView {
	role: OrganizationRole
}

export function toOrganizationOutput(
	organization: OrganizationView
): OrganizationOutput {
	return {
		id: organization.id,
		slug: organization.slug,
		name: organization.name,
		logoUrl: toLogoUrl(organization.logo),
		createdAt: organization.createdAt,
	}
}

export function toOrganizationMembershipOutput({
	role,
	...organization
}: OrganizationMembershipView): OrganizationMembershipOutput {
	return {
		...toOrganizationOutput(organization),
		role,
	}
}

/**
 * Better Auth stores the logo as free text and the contract promises a URL.
 * Nothing in this release writes one, so this only guards the day something
 * does: a stored value that is not a URL is dropped rather than failing
 * response validation and taking a member's whole organization list with it.
 */
function toLogoUrl(logo: string | null): string | undefined {
	if (!logo) return undefined

	try {
		return LOGO_URL_PROTOCOLS.has(new URL(logo).protocol) ? logo : undefined
	} catch {
		return undefined
	}
}
