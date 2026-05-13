import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { InternalBearerTokenGuard } from './presentation/internal-bearer-token.guard'
import { InternalGitRepositoriesController } from './presentation/internal-git-repositories.controller'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryOwnerGuard } from './presentation/repository-owner.guard'

@Module({
	imports: [UserModule],
	controllers: [RepositoriesController, InternalGitRepositoriesController],
	providers: [
		RepositoriesService,
		RepositoriesRepository,
		RepositoryOwnerGuard,
		InternalBearerTokenGuard,
	],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
