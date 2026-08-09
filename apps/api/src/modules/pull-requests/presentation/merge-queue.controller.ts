import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { RepositoryWriteGuard } from '@modules/repositories'
import { Controller, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { MergeQueueService } from '../application/merge-queue.service'

/**
 * The merge queue's three actions. Unlike merging itself, none of them can be
 * refused for policy reasons — joining a queue is not merging — so they are
 * behind the write guard like any other repository mutation.
 */
@Controller()
export class MergeQueueController {
	constructor(private readonly mergeQueueService: MergeQueueService) {}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.joinMergeQueue)
	joinMergeQueue(@Session() session: UserSession) {
		return implement(contract.pullRequests.joinMergeQueue).handler(
			({ input }) => this.mergeQueueService.join(session.user.id, input)
		)
	}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.leaveMergeQueue)
	leaveMergeQueue(@Session() session: UserSession) {
		return implement(contract.pullRequests.leaveMergeQueue).handler(
			({ input }) => this.mergeQueueService.leave(session.user.id, input)
		)
	}

	@RequireAuth()
	@UseGuards(RepositoryWriteGuard)
	@Implement(contract.pullRequests.retryMergeQueueEntry)
	retryMergeQueueEntry(@Session() session: UserSession) {
		return implement(contract.pullRequests.retryMergeQueueEntry).handler(
			({ input }) => this.mergeQueueService.retry(session.user.id, input)
		)
	}
}
