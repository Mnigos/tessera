import { RepositoriesModule } from '@modules/repositories'
import { Module } from '@nestjs/common'
import { PullRequestsService } from './application/pull-requests.service'
import { PullRequestsRepository } from './infrastructure/pull-requests.repository'
import { PullRequestsController } from './presentation/pull-requests.controller'

@Module({
	imports: [RepositoriesModule],
	controllers: [PullRequestsController],
	providers: [PullRequestsService, PullRequestsRepository],
	exports: [PullRequestsService],
})
export class PullRequestsModule {}
