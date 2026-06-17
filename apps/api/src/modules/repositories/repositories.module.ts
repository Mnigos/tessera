import { GitAccessTokensModule } from '@modules/git-access-tokens'
import { GpgPublicKeysModule } from '@modules/gpg-public-keys'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { UserModule } from '@modules/user'
import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import {
	GITHUB_MIRROR_SYNC_QUEUE_NAME,
	GitHubMirrorSyncQueue,
} from './infrastructure/github-mirror-sync.queue'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { GitAuthorizationGrpcController } from './presentation/git-authorization.grpc.controller'
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
		BullModule.registerQueue({ name: GITHUB_MIRROR_SYNC_QUEUE_NAME }),
	],
	controllers: [
		RepositoriesController,
		RepositoryBrowserController,
		GitAuthorizationGrpcController,
	],
	providers: [
		RepositoriesService,
		GitHubMirrorSyncQueue,
		RepositoriesRepository,
		InternalGitAuthorizationGuard,
		RepositoryOwnerGuard,
	],
	exports: [RepositoriesService, RepositoriesRepository],
})
export class RepositoriesModule {}
