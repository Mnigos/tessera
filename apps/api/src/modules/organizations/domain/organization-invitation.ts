import type {
	MyOrganizationInvitation as MyOrganizationInvitationOutput,
	Organization,
	OrganizationInvitation as OrganizationInvitationOutput,
} from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	OrganizationInvitationStatus,
	OrganizationRole,
	UserId,
} from '@repo/domain'
export interface OrganizationInvitationInviterView {
	id: UserId
	username: string | null
	name: string
}

export interface OrganizationInvitationView {
	id: OrganizationInvitationId
	organizationId: OrganizationId
	email: string
	role: OrganizationRole | null
	status: OrganizationInvitationStatus
	expiresAt: Date
	createdAt: Date
	inviter: OrganizationInvitationInviterView
}

export interface MyOrganizationInvitationView
	extends OrganizationInvitationView {
	organization: Organization
}

export function toOrganizationInvitationOutput({
	id,
	organizationId,
	email,
	role,
	status,
	expiresAt,
	createdAt,
	inviter,
}: OrganizationInvitationView): OrganizationInvitationOutput {
	return {
		id,
		organizationId,
		email,
		role: role ?? 'member',
		status,
		expiresAt,
		createdAt,
		inviter: {
			id: inviter.id,
			username: inviter.username,
			displayName: inviter.name,
		},
	}
}

export function toMyOrganizationInvitationOutput({
	organization,
	...invitation
}: MyOrganizationInvitationView): MyOrganizationInvitationOutput {
	return {
		...toOrganizationInvitationOutput(invitation),
		organization: {
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
		},
	}
}

export function isOrganizationInvitationExpired(
	invitation: Pick<OrganizationInvitationView, 'expiresAt'>,
	now: Date
): boolean {
	return invitation.expiresAt.getTime() <= now.getTime()
}
