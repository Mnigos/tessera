import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { TargetUserId } from '@modules/user'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { UserId } from '@repo/domain'
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
	list(@TargetUserId() targetUserId: UserId) {
		return implement(contract.repositories.list).handler(async () => ({
			repositories: await this.repositoriesService.list(targetUserId),
		}))
	}

	@UseGuards(RepositoryOwnerGuard)
	@Implement(contract.repositories.get)
	get(@TargetUserId() targetUserId: UserId) {
		return implement(contract.repositories.get).handler(({ input }) =>
			this.repositoriesService.get(targetUserId, input)
		)
	}
}
