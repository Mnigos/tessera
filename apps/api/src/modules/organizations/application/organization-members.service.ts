import { Injectable } from '@nestjs/common'
import type { Auth } from '@repo/auth'
import type {
	OrganizationMember,
	OrganizationMembersOutput,
	ParsedLeaveOrganizationInput,
	ParsedListOrganizationMembersInput,
	ParsedRemoveOrganizationMemberInput,
	ParsedUpdateOrganizationMemberRoleInput,
} from '@repo/contracts'
import type { OrganizationId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import {
	OrganizationMemberNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import { toOrganizationMemberOutput } from '../domain/organization-member'
import { toOrganizationApiError } from '../helpers/better-auth-organization-error'
import { requireMemberRole } from '../helpers/require-member-role'
import { OrganizationMembersRepository } from '../infrastructure/organization-members.repository'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'

@Injectable()
export class OrganizationMembersService {
	constructor(
		private readonly betterAuthService: BetterAuthService<Auth>,
		private readonly organizationsRepository: OrganizationsRepository,
		private readonly organizationMembersRepository: OrganizationMembersRepository
	) {}

	async listMembers(
		viewerUserId: UserId,
		{ organizationId }: ParsedListOrganizationMembersInput
	): Promise<OrganizationMembersOutput> {
		const viewerRole = await requireMemberRole(this.organizationsRepository, {
			organizationId,
			userId: viewerUserId,
		})
		const members = await this.organizationMembersRepository.listMembers({
			organizationId,
		})

		return { members: members.map(toOrganizationMemberOutput), viewerRole }
	}

	async updateMemberRole(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ memberId, organizationId, role }: ParsedUpdateOrganizationMemberRoleInput
	): Promise<OrganizationMember> {
		await requireMemberRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})

		// Locked: two role changes may not both read the same last owner.
		return await this.organizationsRepository.withOrganizationLock(
			organizationId,
			async () => {
				const member = await this.requireMember(organizationId, memberId)

				try {
					await this.betterAuthService.api.updateMemberRole({
						body: { memberId, organizationId, role },
						headers: actorHeaders,
					})
				} catch (error) {
					throw toOrganizationApiError(error, {
						organizationId,
						memberId,
						role,
					})
				}

				return toOrganizationMemberOutput({ ...member, role })
			}
		)
	}

	async removeMember(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ memberId, organizationId }: ParsedRemoveOrganizationMemberInput
	): Promise<void> {
		await this.organizationsRepository.withOrganizationLock(
			organizationId,
			async () => {
				const actorRole = await requireMemberRole(
					this.organizationsRepository,
					{ organizationId, userId: actorUserId }
				)
				const member = await this.requireMember(organizationId, memberId)

				// Refused here so the refusal is about the role, not the owner count.
				if (member.role === 'owner' && actorRole !== 'owner')
					throw new OrganizationPermissionDeniedError({
						organizationId,
						memberId,
						actorRole,
					})

				try {
					await this.betterAuthService.api.removeMember({
						// The id, never an email: an `@` is read as an address.
						body: { memberIdOrEmail: memberId, organizationId },
						headers: actorHeaders,
					})
				} catch (error) {
					throw toOrganizationApiError(error, { organizationId, memberId })
				}
			}
		)
	}

	async leave(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ organizationId }: ParsedLeaveOrganizationInput
	): Promise<void> {
		await requireMemberRole(this.organizationsRepository, {
			organizationId,
			userId: actorUserId,
		})

		await this.organizationsRepository.withOrganizationLock(
			organizationId,
			async () => {
				try {
					await this.betterAuthService.api.leaveOrganization({
						body: { organizationId },
						headers: actorHeaders,
					})
				} catch (error) {
					throw toOrganizationApiError(error, { organizationId })
				}
			}
		)
	}

	private async requireMember(
		organizationId: OrganizationId,
		memberId: OrganizationMember['id']
	) {
		const member = await this.organizationMembersRepository.findMember({
			memberId,
			organizationId,
		})

		if (!member)
			throw new OrganizationMemberNotFoundError({ organizationId, memberId })

		return member
	}
}
