import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { Module } from '@nestjs/common'
import { PullRequestThreadsService } from './application/pull-request-threads.service'
import { PullRequestsService } from './application/pull-requests.service'
import { PullRequestThreadsRepository } from './infrastructure/pull-request-threads.repository'
import { PullRequestsRepository } from './infrastructure/pull-requests.repository'
import { PullRequestThreadsController } from './presentation/pull-request-threads.controller'
import { PullRequestsController } from './presentation/pull-requests.controller'

@Module({
	imports: [RepositoriesModule],
	controllers: [PullRequestsController, PullRequestThreadsController],
	providers: [
		PullRequestsService,
		PullRequestThreadsService,
		PullRequestsRepository,
		PullRequestThreadsRepository,
		RepositoryWriteGuard,
	],
	exports: [PullRequestsService],
})
export class PullRequestsModule {}
