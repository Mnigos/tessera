import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageModule } from '@config/git-storage'
import { QueueModule } from '@config/queue'
import { RedisModule } from '@config/redis'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { AuthModule } from '@modules/auth'
import { BranchProtectionModule } from '@modules/branch-protection'
import { CheckStatusesModule } from '@modules/check-statuses'
import { DocsModule } from '@modules/docs'
import { GitAccessTokensModule } from '@modules/git-access-tokens'
import { GitHubImportModule } from '@modules/github-import'
import { GitHubSyncModule } from '@modules/github-sync'
import { GpgPublicKeysModule } from '@modules/gpg-public-keys'
import { HealthModule } from '@modules/health'
import { OrganizationsModule } from '@modules/organizations'
import { MergeQueueModule, PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { RepositoryCollaboratorsModule } from '@modules/repository-collaborators'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		RedisModule,
		QueueModule,
		RPCModule,
		AuthModule,
		UserModule,
		GitAccessTokensModule,
		GitHubImportModule,
		GitHubSyncModule,
		GpgPublicKeysModule,
		SshPublicKeysModule,
		OrganizationsModule,
		RepositoriesModule,
		RepositoryCollaboratorsModule,
		BranchProtectionModule,
		CheckStatusesModule,
		PullRequestsModule,
		MergeQueueModule,
		DocsModule,
		HealthModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
export class AppModule {}
