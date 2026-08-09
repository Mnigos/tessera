import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { RepositoryAdminGuard } from '@modules/repositories'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { BranchProtectionService } from '../application/branch-protection.service'

@Controller()
@RequireAuth()
@UseGuards(RepositoryAdminGuard)
export class BranchProtectionController {
	constructor(
		private readonly branchProtectionService: BranchProtectionService
	) {}

	@Implement(contract.branchProtection.list)
	list(@Session() session: UserSession) {
		return implement(contract.branchProtection.list).handler(({ input }) =>
			this.branchProtectionService.list(session.user.id, input)
		)
	}

	@Implement(contract.branchProtection.save)
	save(@Session() session: UserSession) {
		return implement(contract.branchProtection.save).handler(({ input }) =>
			this.branchProtectionService.save(session.user.id, input)
		)
	}

	@Implement(contract.branchProtection.delete)
	delete(@Session() session: UserSession) {
		return implement(contract.branchProtection.delete).handler(({ input }) =>
			this.branchProtectionService.delete(session.user.id, input)
		)
	}
}
