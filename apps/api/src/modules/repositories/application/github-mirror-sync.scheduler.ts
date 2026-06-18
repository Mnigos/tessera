import { EnvService } from '@config/env'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { GitHubMirrorSyncQueue } from '../infrastructure/github-mirror-sync.queue'

@Injectable()
export class GitHubMirrorSyncScheduler implements OnModuleInit {
	private readonly logger = new Logger(GitHubMirrorSyncScheduler.name)

	constructor(
		private readonly githubMirrorSyncQueue: GitHubMirrorSyncQueue,
		private readonly envService: EnvService
	) {}

	async onModuleInit(): Promise<void> {
		const crontime = this.envService.get('GITHUB_MIRROR_SYNC_CRONTIME')

		await this.githubMirrorSyncQueue.scheduleDispatcher(crontime)

		const schedule = await this.githubMirrorSyncQueue.getDispatcherSchedule()
		if (schedule?.next)
			this.logger.log(
				`GitHub mirror sync dispatcher cron will run at ${new Date(schedule.next).toISOString()}`
			)
	}
}
