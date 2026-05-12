import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoryOwnerGuard } from './repository-owner.guard'

@Controller()
@RequireAuth()
export class RepositoriesController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Implement(contract.repositories.create)
	create(@Session() session: UserSession) {
		return implement(contract.repositories.create).handler(({ input }) =>
			this.repositoriesService.create(
				session.user.id,
				session.user.username ?? undefined,
				input
			)
		)
	}

	@UseGuards(RepositoryOwnerGuard)
	@Implement(contract.repositories.list)
	list(@Session() session: UserSession) {
		return implement(contract.repositories.list).handler(() =>
			this.repositoriesService.list(session.user.id)
		)
	}

	@UseGuards(RepositoryOwnerGuard)
	@Implement(contract.repositories.get)
	get(@Session() session: UserSession) {
		return implement(contract.repositories.get).handler(({ input }) =>
			this.repositoriesService.get(session.user.id, input)
		)
	}
}
