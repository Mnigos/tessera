import { GitAccessTokensModule } from '@modules/git-access-tokens'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { GitAuthorizationGrpcController } from './presentation/git-authorization.grpc.controller'
import { InternalGitAuthorizationGuard } from './presentation/internal-git-authorization.guard'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryBrowserController } from './presentation/repository-browser.controller'
import { RepositoryOwnerGuard } from './presentation/repository-owner.guard'

@Module({
	imports: [GitAccessTokensModule, SshPublicKeysModule, UserModule],
	controllers: [
		RepositoriesController,
		RepositoryBrowserController,
		GitAuthorizationGrpcController,
	],
	providers: [
		RepositoriesService,
		RepositoriesRepository,
		InternalGitAuthorizationGuard,
		RepositoryOwnerGuard,
	],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
