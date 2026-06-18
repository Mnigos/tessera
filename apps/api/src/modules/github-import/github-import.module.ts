import { RepositoriesModule } from '@modules/repositories'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { GitHubImportProcessor } from './application/github-import.processor'
import { GitHubImportService } from './application/github-import.service'
import {
	GITHUB_IMPORT_QUEUE_NAME,
	GitHubImportJobQueue,
	GitHubImportQueue,
} from './infrastructure/github-import.queue'
import { GitHubImportRepository } from './infrastructure/github-import.repository'
import { GitHubOctokitClient } from './infrastructure/github-octokit.client'
import { GitHubImportController } from './presentation/github-import.controller'

@Module({
	imports: [
		RepositoriesModule,
		BullModule.registerQueue({ name: GITHUB_IMPORT_QUEUE_NAME }),
	],
	controllers: [GitHubImportController],
	providers: [
		GitHubImportService,
		GitHubImportProcessor,
		{
			provide: GitHubImportJobQueue,
			useExisting: getQueueToken(GITHUB_IMPORT_QUEUE_NAME),
		},
		GitHubImportQueue,
		GitHubImportRepository,
		GitHubOctokitClient,
	],
	exports: [GitHubImportService],
})
export class GitHubImportModule {}
