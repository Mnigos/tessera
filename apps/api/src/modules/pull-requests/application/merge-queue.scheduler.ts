import { EnvService } from '@config/env'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { MergeQueue } from '../infrastructure/merge-queue.queue'

/**
 * Registers the recurring pass that re-derives the merge queue's work from
 * PostgreSQL. Without it a wakeup Redis never delivered would leave a queue
 * with entries in it and nothing running them.
 */
@Injectable()
export class MergeQueueScheduler implements OnModuleInit {
	private readonly logger = new Logger(MergeQueueScheduler.name)

	constructor(
		private readonly mergeQueue: MergeQueue,
		private readonly envService: EnvService
	) {}

	async onModuleInit(): Promise<void> {
		try {
			await this.mergeQueue.scheduleReconciler(
				this.envService.get('MERGE_QUEUE_RECONCILER_CRONTIME')
			)
		} catch (error) {
			this.logger.error(
				'Failed to register the merge queue reconciler schedule',
				error instanceof Error ? error.stack : undefined
			)

			return
		}

		const schedule = await this.mergeQueue.getReconcilerSchedule()

		if (schedule?.next)
			this.logger.log(
				`Merge queue reconciler will run at ${new Date(schedule.next).toISOString()}`
			)
	}
}
