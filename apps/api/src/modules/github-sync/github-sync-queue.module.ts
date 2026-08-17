import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import {
	GITHUB_SYNC_QUEUE_NAME,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from './infrastructure/github-sync.queue'

// Separate from GitHubSyncModule so repositories can enqueue without a cycle.
@Module({
	imports: [BullModule.registerQueue({ name: GITHUB_SYNC_QUEUE_NAME })],
	providers: [
		{
			provide: GitHubSyncJobQueue,
			useExisting: getQueueToken(GITHUB_SYNC_QUEUE_NAME),
		},
		GitHubSyncQueue,
	],
	exports: [GitHubSyncQueue, BullModule],
})
export class GitHubSyncQueueModule {}
