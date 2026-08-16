import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, gt, invitation, organization, user } from '@repo/db'
import type { OrganizationId, OrganizationInvitationId } from '@repo/domain'
import type {
	MyOrganizationInvitationView,
	OrganizationInvitationView,
} from '../domain/organization-invitation'

interface ListPendingParams {
	organizationId: OrganizationId
	now: Date
}

interface ListPendingForEmailParams {
	email: string
	now: Date
}

interface FindInvitationParams {
	invitationId: OrganizationInvitationId
}

const INVITATION_COLUMNS = {
	id: invitation.id,
	organizationId: invitation.organizationId,
	email: invitation.email,
	role: invitation.role,
	status: invitation.status,
	expiresAt: invitation.expiresAt,
	createdAt: invitation.createdAt,
	inviter: {
		id: user.id,
		username: user.username,
		name: user.name,
	},
}

const ORGANIZATION_COLUMNS = {
	id: organization.id,
	slug: organization.slug,
	name: organization.name,
	createdAt: organization.createdAt,
}

@Injectable()
export class OrganizationInvitationsRepository {
	constructor(private readonly db: Database) {}

	async listPending({
		now,
		organizationId,
	}: ListPendingParams): Promise<OrganizationInvitationView[]> {
		return await this.db
			.select(INVITATION_COLUMNS)
			.from(invitation)
			.innerJoin(user, eq(invitation.inviterId, user.id))
			.where(
				and(
					eq(invitation.organizationId, organizationId),
					eq(invitation.status, 'pending'),
					gt(invitation.expiresAt, now)
				)
			)
			.orderBy(asc(invitation.expiresAt), asc(invitation.id))
	}

	async listPendingForEmail({
		email,
		now,
	}: ListPendingForEmailParams): Promise<MyOrganizationInvitationView[]> {
		return await this.db
			.select({ ...INVITATION_COLUMNS, organization: ORGANIZATION_COLUMNS })
			.from(invitation)
			.innerJoin(user, eq(invitation.inviterId, user.id))
			.innerJoin(organization, eq(invitation.organizationId, organization.id))
			.where(
				and(
					eq(invitation.email, email.toLowerCase()),
					eq(invitation.status, 'pending'),
					gt(invitation.expiresAt, now)
				)
			)
			.orderBy(asc(invitation.expiresAt), asc(invitation.id))
	}

	/** Unfiltered: callers have to tell expired from cancelled from accepted. */
	async findById({
		invitationId,
	}: FindInvitationParams): Promise<MyOrganizationInvitationView | undefined> {
		const [row] = await this.db
			.select({ ...INVITATION_COLUMNS, organization: ORGANIZATION_COLUMNS })
			.from(invitation)
			.innerJoin(user, eq(invitation.inviterId, user.id))
			.innerJoin(organization, eq(invitation.organizationId, organization.id))
			.where(eq(invitation.id, invitationId))
			.limit(1)

		return row
	}
}
