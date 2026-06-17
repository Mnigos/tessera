import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { GitHubMirrorSyncProcessor } from './application/github-mirror-sync.processor'
import { GITHUB_MIRROR_SYNC_QUEUE_NAME } from './infrastructure/github-mirror-sync.queue'
import { RepositoriesModule } from './repositories.module'

@Module({
	imports: [
		RepositoriesModule,
		BullModule.registerQueue({ name: GITHUB_MIRROR_SYNC_QUEUE_NAME }),
	],
	providers: [GitHubMirrorSyncProcessor],
})
export class RepositoriesWorkersModule {}
