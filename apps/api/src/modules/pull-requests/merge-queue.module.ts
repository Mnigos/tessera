import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MergeQueueProcessor } from './application/merge-queue.processor'
import { MergeQueueScheduler } from './application/merge-queue.scheduler'
import { MergeQueueService } from './application/merge-queue.service'
import {
	MERGE_QUEUE_NAME,
	MergeQueue,
	MergeQueueJobQueue,
} from './infrastructure/merge-queue.queue'
import { MergeQueueController } from './presentation/merge-queue.controller'
import { PullRequestsModule } from './pull-requests.module'

/**
 * Everything about the merge queue that needs Redis: the worker that runs a
 * repository's queue, the schedule that keeps the reconciler recurring, and the
 * endpoints that mutate a queue and then ask the worker to look.
 *
 * It is a separate module from `PullRequestsModule` because a Bull queue cannot
 * be registered without a connection to register it against. Merging through the
 * queue is one deployment concern; reading and writing pull requests is another,
 * and only this one costs a Redis.
 */
@Module({
	imports: [
		PullRequestsModule,
		RepositoriesModule,
		BullModule.registerQueue({ name: MERGE_QUEUE_NAME }),
	],
	controllers: [MergeQueueController],
	providers: [
		MergeQueueService,
		MergeQueueProcessor,
		MergeQueueScheduler,
		RepositoryWriteGuard,
		{
			provide: MergeQueueJobQueue,
			useExisting: getQueueToken(MERGE_QUEUE_NAME),
		},
		MergeQueue,
	],
})
export class MergeQueueModule {}
