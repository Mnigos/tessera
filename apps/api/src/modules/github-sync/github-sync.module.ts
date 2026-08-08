import { PullRequestsModule } from '@modules/pull-requests'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { GitHubSyncProcessor } from './application/github-sync.processor'
import { GitHubSyncScheduler } from './application/github-sync.scheduler'
import { GitHubWebhookService } from './application/github-webhook.service'
import { GitHubAppAuthService } from './infrastructure/github-app-auth.service'
import { GitHubSyncClient } from './infrastructure/github-sync.client'
import {
	GITHUB_SYNC_QUEUE_NAME,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from './infrastructure/github-sync.queue'
import { GitHubSyncRepository } from './infrastructure/github-sync.repository'
import { GitHubSyncConversationsRepository } from './infrastructure/github-sync-conversations.repository'
import { GitHubWebhookController } from './presentation/github-webhook.controller'

@Module({
	imports: [
		PullRequestsModule,
		BullModule.registerQueue({ name: GITHUB_SYNC_QUEUE_NAME }),
	],
	controllers: [GitHubWebhookController],
	providers: [
		GitHubWebhookService,
		GitHubSyncProcessor,
		GitHubSyncScheduler,
		GitHubAppAuthService,
		GitHubSyncClient,
		GitHubSyncConversationsRepository,
		GitHubSyncRepository,
		{
			provide: GitHubSyncJobQueue,
			useExisting: getQueueToken(GITHUB_SYNC_QUEUE_NAME),
		},
		GitHubSyncQueue,
	],
	exports: [GitHubSyncQueue, GitHubSyncRepository],
})
export class GitHubSyncModule {}
