import { ChecksModule } from '@modules/checks'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { GitHubPullRequestRefreshService } from './application/github-pull-request-refresh.service'
import { GitHubSyncProcessor } from './application/github-sync.processor'
import { GitHubSyncScheduler } from './application/github-sync.scheduler'
import { GitHubSyncReplayService } from './application/github-sync-replay.service'
import { GitHubWebhookService } from './application/github-webhook.service'
import { GitHubAppAuthService } from './infrastructure/github-app-auth.service'
import { GitHubSyncClient } from './infrastructure/github-sync.client'
import {
	GITHUB_SYNC_QUEUE_NAME,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from './infrastructure/github-sync.queue'
import { GitHubSyncRepository } from './infrastructure/github-sync.repository'
import { GitHubSyncChecksRepository } from './infrastructure/github-sync-checks.repository'
import { GitHubSyncConversationsRepository } from './infrastructure/github-sync-conversations.repository'
import { GitHubPullRequestRefreshController } from './presentation/github-pull-request-refresh.controller'
import { GitHubWebhookController } from './presentation/github-webhook.controller'

@Module({
	imports: [
		ChecksModule,
		PullRequestsModule,
		RepositoriesModule,
		BullModule.registerQueue({ name: GITHUB_SYNC_QUEUE_NAME }),
	],
	controllers: [GitHubPullRequestRefreshController, GitHubWebhookController],
	providers: [
		GitHubPullRequestRefreshService,
		GitHubWebhookService,
		GitHubSyncProcessor,
		GitHubSyncReplayService,
		GitHubSyncScheduler,
		GitHubAppAuthService,
		GitHubSyncChecksRepository,
		GitHubSyncClient,
		GitHubSyncConversationsRepository,
		GitHubSyncRepository,
		{
			provide: GitHubSyncJobQueue,
			useExisting: getQueueToken(GITHUB_SYNC_QUEUE_NAME),
		},
		GitHubSyncQueue,
	],
	exports: [
		GitHubPullRequestRefreshService,
		GitHubSyncQueue,
		GitHubSyncReplayService,
		GitHubSyncRepository,
	],
})
export class GitHubSyncModule {}
