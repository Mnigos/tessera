import { BranchProtectionModule } from '@modules/branch-protection'
import { ChecksModule } from '@modules/checks'
import { GitHubWriteThroughModule } from '@modules/github-write-through'
import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { MergeQueueStatusService } from './application/merge-queue-status.service'
import { MergeRequirementsService } from './application/merge-requirements.service'
import { PullRequestActivityService } from './application/pull-request-activity.service'
import { PullRequestFileViewsService } from './application/pull-request-file-views.service'
import { PullRequestHeadResolver } from './application/pull-request-head.resolver'
import { PullRequestMergeRunner } from './application/pull-request-merge.runner'
import { PullRequestPushEventsService } from './application/pull-request-push-events.service'
import { PullRequestReviewsService } from './application/pull-request-reviews.service'
import { PullRequestThreadsService } from './application/pull-request-threads.service'
import { PullRequestsService } from './application/pull-requests.service'
import { MergeQueueRepository } from './infrastructure/merge-queue.repository'
import { PullRequestActivityRepository } from './infrastructure/pull-request-activity.repository'
import { PullRequestFileViewsRepository } from './infrastructure/pull-request-file-views.repository'
import { PullRequestReviewsRepository } from './infrastructure/pull-request-reviews.repository'
import { PullRequestThreadsRepository } from './infrastructure/pull-request-threads.repository'
import { PullRequestsRepository } from './infrastructure/pull-requests.repository'
import { GitPushEventsGrpcController } from './presentation/git-push-events.grpc.controller'
import { PullRequestFileViewsController } from './presentation/pull-request-file-views.controller'
import { PullRequestReviewsController } from './presentation/pull-request-reviews.controller'
import { PullRequestThreadsController } from './presentation/pull-request-threads.controller'
import { PullRequestsController } from './presentation/pull-requests.controller'

/**
 * Pull requests as a domain: opening, reviewing, merging, and reading where an
 * entry stands in the merge queue.
 *
 * Nothing here touches Redis. The merge queue is PostgreSQL, so everything this
 * module needs of it is a query — which is what lets the modules that compose
 * this one, tests included, stand it up without a queue worker to boot. The Bull
 * half lives in `MergeQueueModule`, which imports this one.
 */
@Module({
	imports: [
		BranchProtectionModule,
		ChecksModule,
		GitHubWriteThroughModule,
		RepositoriesModule,
		UserModule,
	],
	controllers: [
		PullRequestsController,
		PullRequestThreadsController,
		PullRequestReviewsController,
		PullRequestFileViewsController,
		GitPushEventsGrpcController,
	],
	providers: [
		PullRequestsService,
		PullRequestActivityService,
		PullRequestThreadsService,
		PullRequestReviewsService,
		PullRequestFileViewsService,
		PullRequestPushEventsService,
		PullRequestHeadResolver,
		PullRequestMergeRunner,
		MergeRequirementsService,
		MergeQueueStatusService,
		MergeQueueRepository,
		PullRequestsRepository,
		PullRequestActivityRepository,
		PullRequestThreadsRepository,
		PullRequestReviewsRepository,
		PullRequestFileViewsRepository,
		RepositoryWriteGuard,
	],
	exports: [
		PullRequestsService,
		MergeQueueStatusService,
		MergeQueueRepository,
		MergeRequirementsService,
		PullRequestMergeRunner,
		PullRequestsRepository,
	],
})
export class PullRequestsModule {}
