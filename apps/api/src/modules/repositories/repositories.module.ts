import { GitAccessTokensModule } from '@modules/git-access-tokens'
import { GpgPublicKeysModule } from '@modules/gpg-public-keys'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoryPermissionsService } from './application/repository-permissions.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { GitAuthorizationGrpcController } from './presentation/git-authorization.grpc.controller'
import { GitRepositoryWriteGuard } from './presentation/git-repository-write.guard'
import { InternalGitAuthorizationGuard } from './presentation/internal-git-authorization.guard'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryBrowserController } from './presentation/repository-browser.controller'
import { RepositoryOwnerGuard } from './presentation/repository-owner.guard'

@Module({
	imports: [
		GitAccessTokensModule,
		GpgPublicKeysModule,
		SshPublicKeysModule,
		UserModule,
	],
	controllers: [
		RepositoriesController,
		RepositoryBrowserController,
		GitAuthorizationGrpcController,
	],
	providers: [
		RepositoriesService,
		RepositoryPermissionsService,
		RepositoriesRepository,
		GitRepositoryWriteGuard,
		InternalGitAuthorizationGuard,
		RepositoryOwnerGuard,
	],
	exports: [
		RepositoriesService,
		RepositoriesRepository,
		RepositoryPermissionsService,
	],
})
export class RepositoriesModule {}
