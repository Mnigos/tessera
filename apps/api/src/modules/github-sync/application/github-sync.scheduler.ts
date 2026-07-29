import { EnvService } from '@config/env'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'

@Injectable()
export class GitHubSyncScheduler implements OnModuleInit {
	private readonly logger = new Logger(GitHubSyncScheduler.name)

	constructor(
		private readonly githubSyncQueue: GitHubSyncQueue,
		private readonly envService: EnvService
	) {}

	async onModuleInit(): Promise<void> {
		await this.githubSyncQueue.scheduleDispatcher(
			this.envService.get('GITHUB_MIRROR_SYNC_CRONTIME')
		)

		const schedule = await this.githubSyncQueue.getDispatcherSchedule()
		if (schedule?.next)
			this.logger.log(
				`GitHub sync dispatcher cron will run at ${new Date(schedule.next).toISOString()}`
			)
	}
}
