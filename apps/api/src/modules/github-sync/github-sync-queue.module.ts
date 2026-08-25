import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import {
	GITHUB_SYNC_QUEUE_NAME,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from './infrastructure/github-sync.queue'

// RepositoriesService enqueues syncs, but it cannot get the queue from
// GitHubSyncModule: that module already depends on RepositoriesModule (via
// PullRequestsModule), so importing it back would be a circular import.
// Keeping the queue in this standalone module lets both sides import it.
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
