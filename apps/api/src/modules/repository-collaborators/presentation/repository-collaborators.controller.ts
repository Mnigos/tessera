import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { RepositoryAdminGuard } from '@modules/repositories'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { RepositoryCollaboratorsService } from '../application/repository-collaborators.service'

@Controller()
@RequireAuth()
@UseGuards(RepositoryAdminGuard)
export class RepositoryCollaboratorsController {
	constructor(
		private readonly repositoryCollaboratorsService: RepositoryCollaboratorsService
	) {}

	@Implement(contract.repositoryCollaborators.list)
	list(@Session() session: UserSession) {
		return implement(contract.repositoryCollaborators.list).handler(
			async ({ input }) => ({
				collaborators: await this.repositoryCollaboratorsService.list(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.repositoryCollaborators.add)
	add(@Session() session: UserSession) {
		return implement(contract.repositoryCollaborators.add).handler(
			({ input }) =>
				this.repositoryCollaboratorsService.add(session.user.id, input)
		)
	}

	@Implement(contract.repositoryCollaborators.updateRole)
	updateRole(@Session() session: UserSession) {
		return implement(contract.repositoryCollaborators.updateRole).handler(
			({ input }) =>
				this.repositoryCollaboratorsService.updateRole(session.user.id, input)
		)
	}

	@Implement(contract.repositoryCollaborators.remove)
	remove(@Session() session: UserSession) {
		return implement(contract.repositoryCollaborators.remove).handler(
			({ input }) =>
				this.repositoryCollaboratorsService.remove(session.user.id, input)
		)
	}
}
