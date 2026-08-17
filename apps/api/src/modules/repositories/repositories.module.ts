import { ChecksModule } from '@modules/checks'
import { GitAccessTokensModule } from '@modules/git-access-tokens'
import { GitHubSyncQueueModule } from '@modules/github-sync/github-sync-queue.module'
import { GpgPublicKeysModule } from '@modules/gpg-public-keys'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoryPermissionsService } from './application/repository-permissions.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { RepositorySyncHealthRepository } from './infrastructure/repository-sync-health.repository'
import { GitAuthorizationGrpcController } from './presentation/git-authorization.grpc.controller'
import { GitRepositoryWriteGuard } from './presentation/git-repository-write.guard'
import { InternalGitAuthorizationGuard } from './presentation/internal-git-authorization.guard'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryBrowserController } from './presentation/repository-browser.controller'

@Module({
	imports: [
		ChecksModule,
		GitAccessTokensModule,
		GitHubSyncQueueModule,
		GpgPublicKeysModule,
		SshPublicKeysModule,
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
		RepositorySyncHealthRepository,
		GitRepositoryWriteGuard,
		InternalGitAuthorizationGuard,
	],
	exports: [
		RepositoriesService,
		RepositoriesRepository,
		RepositoryPermissionsService,
		InternalGitAuthorizationGuard,
	],
})
export class RepositoriesModule {}
