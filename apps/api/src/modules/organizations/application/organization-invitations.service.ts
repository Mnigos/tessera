import { Injectable } from '@nestjs/common'
import type { Auth } from '@repo/auth'
import type {
	MyOrganizationInvitation,
	OrganizationInvitation,
	OrganizationMembership,
	ParsedCancelOrganizationInvitationInput,
	ParsedInviteOrganizationMemberInput,
	ParsedListOrganizationInvitationsInput,
	ParsedMyOrganizationInvitationInput,
	ParsedResendOrganizationInvitationInput,
} from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import {
	OrganizationInvitationEmailMismatchError,
	OrganizationInvitationExpiredError,
	OrganizationInvitationNotFoundError,
} from '../domain/organization.errors'
import {
	isOrganizationInvitationExpired,
	type MyOrganizationInvitationView,
	toMyOrganizationInvitationOutput,
	toOrganizationInvitationOutput,
} from '../domain/organization-invitation'
import { toOrganizationApiError } from '../helpers/better-auth-organization-error'
import { requireManagerRole } from '../helpers/require-member-role'
import { OrganizationInvitationsRepository } from '../infrastructure/organization-invitations.repository'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'

interface CreateInvitationBody {
	email: string
	organizationId: OrganizationId
	role: OrganizationInvitation['role']
	resend?: boolean
}

interface InvitationParams {
	invitationId: OrganizationInvitationId
	organizationId: OrganizationId
}

@Injectable()
export class OrganizationInvitationsService {
	constructor(
		private readonly betterAuthService: BetterAuthService<Auth>,
		private readonly organizationsRepository: OrganizationsRepository,
		private readonly organizationInvitationsRepository: OrganizationInvitationsRepository
	) {}

	async listInvitations(
		actorUserId: UserId,
		{ organizationId }: ParsedListOrganizationInvitationsInput
	): Promise<OrganizationInvitation[]> {
		await requireManagerRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})

		const invitations =
			await this.organizationInvitationsRepository.listPending({
				organizationId,
				now: new Date(),
			})

		return invitations.map(toOrganizationInvitationOutput)
	}

	async invite(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ email, organizationId, role }: ParsedInviteOrganizationMemberInput
	): Promise<OrganizationInvitation> {
		await requireManagerRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})

		return await this.createInvitation(actorHeaders, {
			email,
			organizationId,
			role,
		})
	}

	async resendInvitation(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ invitationId, organizationId }: ParsedResendOrganizationInvitationInput
	): Promise<OrganizationInvitation> {
		await requireManagerRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})
		const invitation = await this.requirePendingInvitation({
			invitationId,
			organizationId,
		})
		// Retired first: the pending-email index still counts a lapsed row.
		if (isOrganizationInvitationExpired(invitation, new Date()))
			await this.cancelWithBetterAuth(actorHeaders, {
				invitationId,
				organizationId,
			})

		return await this.createInvitation(actorHeaders, {
			email: invitation.email,
			organizationId,
			role: invitation.role ?? 'member',
			resend: true,
		})
	}

	async cancelInvitation(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ invitationId, organizationId }: ParsedCancelOrganizationInvitationInput
	): Promise<void> {
		await requireManagerRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})
		await this.requirePendingInvitation({ invitationId, organizationId })

		await this.cancelWithBetterAuth(actorHeaders, {
			invitationId,
			organizationId,
		})
	}

	async listMyInvitations(email: string): Promise<MyOrganizationInvitation[]> {
		const invitations =
			await this.organizationInvitationsRepository.listPendingForEmail({
				email,
				now: new Date(),
			})

		return invitations.map(toMyOrganizationInvitationOutput)
	}

	async getMyInvitation(
		recipientEmail: string,
		{ invitationId }: ParsedMyOrganizationInvitationInput
	): Promise<MyOrganizationInvitation> {
		const invitation = await this.requireRecipientInvitation(
			recipientEmail,
			invitationId,
			'hide-mismatch'
		)

		if (isOrganizationInvitationExpired(invitation, new Date()))
			throw new OrganizationInvitationExpiredError({ invitationId })

		return toMyOrganizationInvitationOutput(invitation)
	}

	async acceptInvitation(
		recipientEmail: string,
		actorHeaders: Record<string, string>,
		{ invitationId }: ParsedMyOrganizationInvitationInput
	): Promise<OrganizationMembership> {
		const invitation = await this.requireRecipientInvitation(
			recipientEmail,
			invitationId,
			'refuse-mismatch'
		)

		if (isOrganizationInvitationExpired(invitation, new Date()))
			throw new OrganizationInvitationExpiredError({ invitationId })

		try {
			await this.betterAuthService.api.acceptInvitation({
				body: { invitationId },
				headers: actorHeaders,
			})
		} catch (error) {
			throw toOrganizationApiError(error, { invitationId })
		}

		return { ...invitation.organization, role: invitation.role ?? 'member' }
	}

	// Lapsed invitations may still be declined: it clears a list, nothing more.
	async declineInvitation(
		recipientEmail: string,
		actorHeaders: Record<string, string>,
		{ invitationId }: ParsedMyOrganizationInvitationInput
	): Promise<void> {
		await this.requireRecipientInvitation(
			recipientEmail,
			invitationId,
			'refuse-mismatch'
		)

		try {
			await this.betterAuthService.api.rejectInvitation({
				body: { invitationId },
				headers: actorHeaders,
			})
		} catch (error) {
			throw toOrganizationApiError(error, { invitationId })
		}
	}

	private async createInvitation(
		actorHeaders: Record<string, string>,
		body: CreateInvitationBody
	): Promise<OrganizationInvitation> {
		const invitationId = await this.createWithBetterAuth(actorHeaders, body)
		// Read back for the inviter, which the create response does not carry.
		const invitation = await this.organizationInvitationsRepository.findById({
			invitationId,
		})

		if (!invitation)
			throw new OrganizationInvitationNotFoundError({
				organizationId: body.organizationId,
				invitationId,
			})

		return toOrganizationInvitationOutput(invitation)
	}

	private async createWithBetterAuth(
		actorHeaders: Record<string, string>,
		body: CreateInvitationBody
	): Promise<OrganizationInvitationId> {
		try {
			const { id } = await this.betterAuthService.api.createInvitation({
				body,
				headers: actorHeaders,
			})

			return id as OrganizationInvitationId
		} catch (error) {
			throw toOrganizationApiError(error, {
				organizationId: body.organizationId,
				role: body.role,
			})
		}
	}

	private async cancelWithBetterAuth(
		actorHeaders: Record<string, string>,
		{ invitationId, organizationId }: InvitationParams
	): Promise<void> {
		try {
			await this.betterAuthService.api.cancelInvitation({
				body: { invitationId },
				headers: actorHeaders,
			})
		} catch (error) {
			throw toOrganizationApiError(error, { invitationId, organizationId })
		}
	}

	private async requirePendingInvitation({
		invitationId,
		organizationId,
	}: InvitationParams): Promise<MyOrganizationInvitationView> {
		const invitation = await this.organizationInvitationsRepository.findById({
			invitationId,
		})

		if (
			!invitation ||
			invitation.organizationId !== organizationId ||
			invitation.status !== 'pending'
		)
			throw new OrganizationInvitationNotFoundError({
				organizationId,
				invitationId,
			})

		return invitation
	}

	private async requireRecipientInvitation(
		recipientEmail: string,
		invitationId: OrganizationInvitationId,
		onMismatch: 'hide-mismatch' | 'refuse-mismatch'
	): Promise<MyOrganizationInvitationView> {
		const invitation = await this.organizationInvitationsRepository.findById({
			invitationId,
		})
		const isRecipient =
			invitation && isSameEmail(invitation.email, recipientEmail)

		if (
			!invitation ||
			invitation.status !== 'pending' ||
			(!isRecipient && onMismatch === 'hide-mismatch')
		)
			throw new OrganizationInvitationNotFoundError({ invitationId })

		if (!isRecipient)
			throw new OrganizationInvitationEmailMismatchError({ invitationId })

		return invitation
	}
}

function isSameEmail(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase()
}
