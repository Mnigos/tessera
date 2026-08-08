import { ChecksModule } from '@modules/checks'
import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { PullRequestHeadResolver } from './application/pull-request-head.resolver'
import { PullRequestReviewsService } from './application/pull-request-reviews.service'
import { PullRequestThreadsService } from './application/pull-request-threads.service'
import { PullRequestsService } from './application/pull-requests.service'
import { PullRequestReviewsRepository } from './infrastructure/pull-request-reviews.repository'
import { PullRequestThreadsRepository } from './infrastructure/pull-request-threads.repository'
import { PullRequestsRepository } from './infrastructure/pull-requests.repository'
import { PullRequestReviewsController } from './presentation/pull-request-reviews.controller'
import { PullRequestThreadsController } from './presentation/pull-request-threads.controller'
import { PullRequestsController } from './presentation/pull-requests.controller'

@Module({
	imports: [ChecksModule, RepositoriesModule, UserModule],
	controllers: [
		PullRequestsController,
		PullRequestThreadsController,
		PullRequestReviewsController,
	],
	providers: [
		PullRequestsService,
		PullRequestThreadsService,
		PullRequestReviewsService,
		PullRequestHeadResolver,
		PullRequestsRepository,
		PullRequestThreadsRepository,
		PullRequestReviewsRepository,
		RepositoryWriteGuard,
	],
	exports: [PullRequestsService],
})
export class PullRequestsModule {}
