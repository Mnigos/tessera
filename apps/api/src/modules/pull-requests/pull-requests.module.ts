import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { PullRequestsService } from './application/pull-requests.service'
import { PullRequestsRepository } from './infrastructure/pull-requests.repository'
import { PullRequestsController } from './presentation/pull-requests.controller'

@Module({
	imports: [RepositoriesModule, UserModule],
	controllers: [PullRequestsController],
	providers: [
		PullRequestsService,
		PullRequestsRepository,
		RepositoryWriteGuard,
	],
	exports: [PullRequestsService],
})
export class PullRequestsModule {}
