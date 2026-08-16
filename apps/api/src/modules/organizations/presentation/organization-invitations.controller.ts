import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller, Req } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { AppRequest } from '~/shared/types/app-request'
import { OrganizationInvitationsService } from '../application/organization-invitations.service'
import { toForwardedAuthHeaders } from '../helpers/forwarded-auth-headers'

@Controller()
@RequireAuth()
export class OrganizationInvitationsController {
	constructor(
		private readonly organizationInvitationsService: OrganizationInvitationsService
	) {}

	@Implement(contract.organizations.listInvitations)
	listInvitations(@Session() session: UserSession) {
		return implement(contract.organizations.listInvitations).handler(
			async ({ input }) => ({
				invitations: await this.organizationInvitationsService.listInvitations(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.organizations.invite)
	invite(@Req() request: AppRequest, @Session() session: UserSession) {
		return implement(contract.organizations.invite).handler(
			async ({ input }) => ({
				invitation: await this.organizationInvitationsService.invite(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				),
			})
		)
	}

	@Implement(contract.organizations.resendInvitation)
	resendInvitation(
		@Req() request: AppRequest,
		@Session() session: UserSession
	) {
		return implement(contract.organizations.resendInvitation).handler(
			async ({ input }) => ({
				invitation: await this.organizationInvitationsService.resendInvitation(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				),
			})
		)
	}

	@Implement(contract.organizations.cancelInvitation)
	cancelInvitation(
		@Req() request: AppRequest,
		@Session() session: UserSession
	) {
		return implement(contract.organizations.cancelInvitation).handler(
			async ({ input }) => {
				await this.organizationInvitationsService.cancelInvitation(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				)

				return { canceled: true as const }
			}
		)
	}

	@Implement(contract.organizations.listMyInvitations)
	listMyInvitations(@Session() session: UserSession) {
		return implement(contract.organizations.listMyInvitations).handler(
			async () => ({
				invitations:
					await this.organizationInvitationsService.listMyInvitations(
						session.user.email
					),
			})
		)
	}

	@Implement(contract.organizations.getMyInvitation)
	getMyInvitation(@Session() session: UserSession) {
		return implement(contract.organizations.getMyInvitation).handler(
			async ({ input }) => ({
				invitation: await this.organizationInvitationsService.getMyInvitation(
					session.user.email,
					input
				),
			})
		)
	}

	@Implement(contract.organizations.acceptInvitation)
	acceptInvitation(
		@Req() request: AppRequest,
		@Session() session: UserSession
	) {
		return implement(contract.organizations.acceptInvitation).handler(
			async ({ input }) => ({
				organization:
					await this.organizationInvitationsService.acceptInvitation(
						session.user.email,
						toForwardedAuthHeaders(request),
						input
					),
			})
		)
	}

	@Implement(contract.organizations.declineInvitation)
	declineInvitation(
		@Req() request: AppRequest,
		@Session() session: UserSession
	) {
		return implement(contract.organizations.declineInvitation).handler(
			async ({ input }) => {
				await this.organizationInvitationsService.declineInvitation(
					session.user.email,
					toForwardedAuthHeaders(request),
					input
				)

				return { declined: true as const }
			}
		)
	}
}
