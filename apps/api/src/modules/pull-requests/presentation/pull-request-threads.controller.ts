import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { PullRequestThreadsService } from '../application/pull-request-threads.service'

@Controller()
export class PullRequestThreadsController {
	constructor(
		private readonly pullRequestThreadsService: PullRequestThreadsService
	) {}

	@Implement(contract.pullRequests.listThreads)
	listThreads(@Session() session?: UserSession) {
		return implement(contract.pullRequests.listThreads).handler(({ input }) =>
			this.pullRequestThreadsService.list(session?.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.createThread)
	createThread(@Session() session: UserSession) {
		return implement(contract.pullRequests.createThread).handler(({ input }) =>
			this.pullRequestThreadsService.createThread(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.replyThread)
	replyThread(@Session() session: UserSession) {
		return implement(contract.pullRequests.replyThread).handler(({ input }) =>
			this.pullRequestThreadsService.replyThread(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.editComment)
	editComment(@Session() session: UserSession) {
		return implement(contract.pullRequests.editComment).handler(({ input }) =>
			this.pullRequestThreadsService.editComment(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.deleteComment)
	deleteComment(@Session() session: UserSession) {
		return implement(contract.pullRequests.deleteComment).handler(({ input }) =>
			this.pullRequestThreadsService.deleteComment(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.resolveThread)
	resolveThread(@Session() session: UserSession) {
		return implement(contract.pullRequests.resolveThread).handler(({ input }) =>
			this.pullRequestThreadsService.resolveThread(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.unresolveThread)
	unresolveThread(@Session() session: UserSession) {
		return implement(contract.pullRequests.unresolveThread).handler(
			({ input }) =>
				this.pullRequestThreadsService.unresolveThread(session.user.id, input)
		)
	}
}
