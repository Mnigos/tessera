import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller, Req } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { AppRequest } from '~/shared/types/app-request'
import { OrganizationMembersService } from '../application/organization-members.service'
import { toForwardedAuthHeaders } from '../helpers/forwarded-auth-headers'

@Controller()
@RequireAuth()
export class OrganizationMembersController {
	constructor(
		private readonly organizationMembersService: OrganizationMembersService
	) {}

	@Implement(contract.organizations.listMembers)
	listMembers(@Session() session: UserSession) {
		return implement(contract.organizations.listMembers).handler(({ input }) =>
			this.organizationMembersService.listMembers(session.user.id, input)
		)
	}

	@Implement(contract.organizations.updateMemberRole)
	updateMemberRole(
		@Req() request: AppRequest,
		@Session() session: UserSession
	) {
		return implement(contract.organizations.updateMemberRole).handler(
			async ({ input }) => ({
				member: await this.organizationMembersService.updateMemberRole(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				),
			})
		)
	}

	@Implement(contract.organizations.removeMember)
	removeMember(@Req() request: AppRequest, @Session() session: UserSession) {
		return implement(contract.organizations.removeMember).handler(
			async ({ input }) => {
				await this.organizationMembersService.removeMember(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				)

				return { removed: true as const }
			}
		)
	}

	@Implement(contract.organizations.leave)
	leave(@Req() request: AppRequest, @Session() session: UserSession) {
		return implement(contract.organizations.leave).handler(
			async ({ input }) => {
				await this.organizationMembersService.leave(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				)

				return { left: true as const }
			}
		)
	}
}
