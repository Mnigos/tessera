import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller, Req } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { AppRequest } from '~/shared/types/app-request'
import { OrganizationsService } from '../application/organizations.service'
import { toForwardedAuthHeaders } from '../helpers/forwarded-auth-headers'

@Controller()
@RequireAuth()
export class OrganizationsController {
	constructor(private readonly organizationsService: OrganizationsService) {}

	@Implement(contract.organizations.list)
	list(@Session() session: UserSession) {
		return implement(contract.organizations.list).handler(async () => ({
			organizations: await this.organizationsService.list(session.user.id),
		}))
	}

	@Implement(contract.organizations.create)
	create(@Session() session: UserSession) {
		return implement(contract.organizations.create).handler(
			async ({ input }) => ({
				organization: await this.organizationsService.create(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.organizations.get)
	get(@Session() session: UserSession) {
		return implement(contract.organizations.get).handler(({ input }) =>
			this.organizationsService.get(session.user.id, input)
		)
	}

	@Implement(contract.organizations.update)
	update(@Req() request: AppRequest, @Session() session: UserSession) {
		return implement(contract.organizations.update).handler(
			async ({ input }) => ({
				organization: await this.organizationsService.update(
					session.user.id,
					toForwardedAuthHeaders(request),
					input
				),
			})
		)
	}

	@Implement(contract.organizations.delete)
	delete(@Session() session: UserSession) {
		return implement(contract.organizations.delete).handler(
			async ({ input }) => {
				await this.organizationsService.delete(session.user.id, input)

				return { deleted: true as const }
			}
		)
	}
}
