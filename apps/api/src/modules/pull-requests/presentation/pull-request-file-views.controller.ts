import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { PullRequestFileViewsService } from '../application/pull-request-file-views.service'

@Controller()
export class PullRequestFileViewsController {
	constructor(
		private readonly pullRequestFileViewsService: PullRequestFileViewsService
	) {}

	@RequireAuth()
	@Implement(contract.pullRequests.listViewedFiles)
	listViewedFiles(@Session() session: UserSession) {
		return implement(contract.pullRequests.listViewedFiles).handler(
			({ input }) =>
				this.pullRequestFileViewsService.listViewedFiles(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.setFileViewed)
	setFileViewed(@Session() session: UserSession) {
		return implement(contract.pullRequests.setFileViewed).handler(({ input }) =>
			this.pullRequestFileViewsService.setFileViewed(session.user.id, input)
		)
	}
}
