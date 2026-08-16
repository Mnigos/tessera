import type {
	OrganizationMembership as OrganizationMembershipOutput,
	Organization as OrganizationOutput,
} from '@repo/contracts'
import type { Organization } from '@repo/db'
import type { OrganizationId, OrganizationRole } from '@repo/domain'

const LOGO_URL_PROTOCOLS = new Set(['http:', 'https:'])

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

interface BetterAuthOrganization {
	id: string
	slug: string
	name: string
	logo?: string | null
	createdAt: Date
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

export function betterAuthOrganizationToOutput({
	id,
	slug,
	name,
	logo,
	createdAt,
}: BetterAuthOrganization): OrganizationOutput {
	return toOrganizationOutput({
		id: id as OrganizationId,
		slug,
		name,
		logo: logo ?? null,
		createdAt,
	})
}

// Better Auth stores the logo as free text and the contract promises a URL; a
// stored non-URL is dropped rather than failing response validation.
function toLogoUrl(logo: string | null): string | undefined {
	if (!logo) return undefined

	try {
		return LOGO_URL_PROTOCOLS.has(new URL(logo).protocol) ? logo : undefined
	} catch {
		return undefined
	}
}
