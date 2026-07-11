import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { RepositoryWriteGuard } from '@modules/repositories'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { PullRequestsService } from '../application/pull-requests.service'

@Controller()
export class PullRequestsController {
	constructor(private readonly pullRequestsService: PullRequestsService) {}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.create)
	create(@Session() session: UserSession) {
		return implement(contract.pullRequests.create).handler(({ input }) =>
			this.pullRequestsService.create(session.user.id, input)
		)
	}

	@Implement(contract.pullRequests.list)
	list(@Session() session?: UserSession) {
		return implement(contract.pullRequests.list).handler(async ({ input }) => ({
			pullRequests: await this.pullRequestsService.list(
				session?.user.id,
				input
			),
		}))
	}

	@Implement(contract.pullRequests.get)
	get(@Session() session?: UserSession) {
		return implement(contract.pullRequests.get).handler(({ input }) =>
			this.pullRequestsService.get(session?.user.id, input)
		)
	}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.edit)
	edit(@Session() session: UserSession) {
		return implement(contract.pullRequests.edit).handler(({ input }) =>
			this.pullRequestsService.edit(session.user.id, input)
		)
	}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.close)
	close(@Session() session: UserSession) {
		return implement(contract.pullRequests.close).handler(({ input }) =>
			this.pullRequestsService.close(session.user.id, input)
		)
	}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.reopen)
	reopen(@Session() session: UserSession) {
		return implement(contract.pullRequests.reopen).handler(({ input }) =>
			this.pullRequestsService.reopen(session.user.id, input)
		)
	}
}
