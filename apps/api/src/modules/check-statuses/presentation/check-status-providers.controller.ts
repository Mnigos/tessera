import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { RepositoryAdminGuard } from '@modules/repositories'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { CheckStatusProvidersService } from '../application/check-status-providers.service'

@Controller()
@RequireAuth()
@UseGuards(RepositoryAdminGuard)
export class CheckStatusProvidersController {
	constructor(
		private readonly checkStatusProvidersService: CheckStatusProvidersService
	) {}

	@Implement(contract.checks.listStatusProviders)
	listStatusProviders(@Session() session: UserSession) {
		return implement(contract.checks.listStatusProviders).handler(({ input }) =>
			this.checkStatusProvidersService.list(session.user.id, input)
		)
	}

	@Implement(contract.checks.createStatusProvider)
	createStatusProvider(@Session() session: UserSession) {
		return implement(contract.checks.createStatusProvider).handler(
			({ input }) =>
				this.checkStatusProvidersService.createProvider(session.user.id, input)
		)
	}

	@Implement(contract.checks.createStatusCredential)
	createStatusCredential(@Session() session: UserSession) {
		return implement(contract.checks.createStatusCredential).handler(
			({ input }) =>
				this.checkStatusProvidersService.createCredential(
					session.user.id,
					input
				)
		)
	}

	@Implement(contract.checks.revokeStatusCredential)
	revokeStatusCredential(@Session() session: UserSession) {
		return implement(contract.checks.revokeStatusCredential).handler(
			({ input }) =>
				this.checkStatusProvidersService.revokeCredential(
					session.user.id,
					input
				)
		)
	}
}
