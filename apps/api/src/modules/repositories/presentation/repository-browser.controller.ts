import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { RepositoriesService } from '../application/repositories.service'

@Controller()
export class RepositoryBrowserController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Implement(contract.repositories.getBrowserSummary)
	getBrowserSummary(@Session() session?: UserSession) {
		return implement(contract.repositories.getBrowserSummary).handler(
			({ input }) =>
				this.repositoriesService.getBrowserSummary(session?.user.id, input)
		)
	}
}
