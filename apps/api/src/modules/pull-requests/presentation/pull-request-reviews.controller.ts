import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { PullRequestReviewsService } from '../application/pull-request-reviews.service'

@Controller()
export class PullRequestReviewsController {
	constructor(
		private readonly pullRequestReviewsService: PullRequestReviewsService
	) {}

	@RequireAuth()
	@Implement(contract.pullRequests.requestReviewer)
	requestReviewer(@Session() session: UserSession) {
		return implement(contract.pullRequests.requestReviewer).handler(
			({ input }) =>
				this.pullRequestReviewsService.requestReviewer(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.removeReviewerRequest)
	removeReviewerRequest(@Session() session: UserSession) {
		return implement(contract.pullRequests.removeReviewerRequest).handler(
			({ input }) =>
				this.pullRequestReviewsService.removeReviewerRequest(
					session.user.id,
					input
				)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.submitReview)
	submitReview(@Session() session: UserSession) {
		return implement(contract.pullRequests.submitReview).handler(({ input }) =>
			this.pullRequestReviewsService.submitReview(session.user.id, input)
		)
	}

	@RequireAuth()
	@Implement(contract.pullRequests.discardPendingReview)
	discardPendingReview(@Session() session: UserSession) {
		return implement(contract.pullRequests.discardPendingReview).handler(
			({ input }) =>
				this.pullRequestReviewsService.discardPendingReview(
					session.user.id,
					input
				)
		)
	}
}
