import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { GitHubPullRequestRefreshService } from '../application/github-pull-request-refresh.service'

/** Here rather than beside the other pull request routes: this is synchronization. */
@Controller()
export class GitHubPullRequestRefreshController {
	constructor(
		private readonly gitHubPullRequestRefreshService: GitHubPullRequestRefreshService
	) {}

	// Authenticated, unlike the pull request reads: this one spends the
	// installation's GitHub budget, so it is only ever spent by somebody.
	@RequireAuth()
	@Implement(contract.pullRequests.refreshGitHub)
	refreshGitHub(@Session() session: UserSession) {
		return implement(contract.pullRequests.refreshGitHub).handler(({ input }) =>
			this.gitHubPullRequestRefreshService.refresh(session.user.id, input)
		)
	}
}
