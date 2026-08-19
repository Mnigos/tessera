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
		return implement(contract.pullRequests.list).handler(({ input }) =>
			this.pullRequestsService.list(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.get)
	get(@Session() session?: UserSession) {
		return implement(contract.pullRequests.get).handler(({ input }) =>
			this.pullRequestsService.get(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.comparison)
	comparison(@Session() session?: UserSession) {
		return implement(contract.pullRequests.comparison).handler(({ input }) =>
			this.pullRequestsService.comparison(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.reviewComparison)
	reviewComparison(@Session() session?: UserSession) {
		return implement(contract.pullRequests.reviewComparison).handler(
			({ input }) =>
				this.pullRequestsService.reviewComparison(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.fileDiff)
	fileDiff(@Session() session?: UserSession) {
		return implement(contract.pullRequests.fileDiff).handler(({ input }) =>
			this.pullRequestsService.fileDiff(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.fileLines)
	fileLines(@Session() session?: UserSession) {
		return implement(contract.pullRequests.fileLines).handler(({ input }) =>
			this.pullRequestsService.fileLines(session?.user.id, input)
		)
	}

	@Implement(contract.pullRequests.listChecks)
	listChecks(@Session() session?: UserSession) {
		return implement(contract.pullRequests.listChecks).handler(({ input }) =>
			this.pullRequestsService.listChecks(session?.user.id, input)
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
	@Implement(contract.pullRequests.retarget)
	retarget(@Session() session: UserSession) {
		return implement(contract.pullRequests.retarget).handler(({ input }) =>
			this.pullRequestsService.retarget(session.user.id, input)
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

	// Authenticated, unlike the other reads on this controller: the answer is
	// about whether *you* may merge, which is meaningless without an identity, and
	// evaluating it drives merge-tree work in Git storage that anonymous callers
	// have no reason to be able to ask for.
	@RequireAuth()
	@Implement(contract.pullRequests.getMergeRequirements)
	getMergeRequirements(@Session() session: UserSession) {
		return implement(contract.pullRequests.getMergeRequirements).handler(
			({ input }) =>
				this.pullRequestsService.getMergeRequirements(session.user.id, input)
		)
	}

	// Deliberately not behind the write guard: refusing an unprivileged merge is
	// part of the answer this endpoint returns, and the guard would turn it into
	// an error the client cannot render alongside the other blockers.
	@RequireAuth()
	@Implement(contract.pullRequests.merge)
	merge(@Session() session: UserSession) {
		return implement(contract.pullRequests.merge).handler(({ input }) =>
			this.pullRequestsService.merge(
				{
					id: session.user.id,
					name: session.user.name,
					email: session.user.email,
				},
				input
			)
		)
	}
}
