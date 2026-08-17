import { ChecksModule } from '@modules/checks'
import { PullRequestsModule } from '@modules/pull-requests'
import { Module } from '@nestjs/common'
import { GitHubSyncProcessor } from './application/github-sync.processor'
import { GitHubSyncScheduler } from './application/github-sync.scheduler'
import { GitHubSyncReplayService } from './application/github-sync-replay.service'
import { GitHubWebhookService } from './application/github-webhook.service'
import { GitHubSyncQueueModule } from './github-sync-queue.module'
import { GitHubAppAuthService } from './infrastructure/github-app-auth.service'
import { GitHubSyncClient } from './infrastructure/github-sync.client'
import { GitHubSyncRepository } from './infrastructure/github-sync.repository'
import { GitHubSyncChecksRepository } from './infrastructure/github-sync-checks.repository'
import { GitHubSyncConversationsRepository } from './infrastructure/github-sync-conversations.repository'
import { GitHubWebhookController } from './presentation/github-webhook.controller'

@Module({
	imports: [ChecksModule, PullRequestsModule, GitHubSyncQueueModule],
	controllers: [GitHubWebhookController],
	providers: [
		GitHubWebhookService,
		GitHubSyncProcessor,
		GitHubSyncReplayService,
		GitHubSyncScheduler,
		GitHubAppAuthService,
		GitHubSyncChecksRepository,
		GitHubSyncClient,
		GitHubSyncConversationsRepository,
		GitHubSyncRepository,
	],
	exports: [
		GitHubSyncQueueModule,
		GitHubSyncReplayService,
		GitHubSyncRepository,
	],
})
export class GitHubSyncModule {}
