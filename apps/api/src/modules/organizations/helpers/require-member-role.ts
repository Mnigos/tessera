import type { OrganizationId, OrganizationRole, UserId } from '@repo/domain'
import {
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import type { OrganizationsRepository } from '../infrastructure/organizations.repository'

interface MemberRoleParams {
	organizationId: OrganizationId
	userId: UserId
}

/** Non-members are told the organization does not exist rather than refused. */
export async function requireMemberRole(
	organizationsRepository: OrganizationsRepository,
	{ organizationId, userId }: MemberRoleParams
): Promise<OrganizationRole> {
	const role = await organizationsRepository.findMemberRole({
		organizationId,
		userId,
	})

	if (!role) throw new OrganizationNotFoundError({ organizationId })

	return role
}

export async function requireManagerRole(
	organizationsRepository: OrganizationsRepository,
	params: MemberRoleParams
): Promise<OrganizationRole> {
	const role = await requireMemberRole(organizationsRepository, params)

	if (role === 'member')
		throw new OrganizationPermissionDeniedError({
			organizationId: params.organizationId,
			actorRole: role,
		})

	return role
}
