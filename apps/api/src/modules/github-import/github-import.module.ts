import { Module } from '@nestjs/common'
import { GitHubImportService } from './application/github-import.service'
import { GitHubImportRepository } from './infrastructure/github-import.repository'
import { GitHubOctokitClient } from './infrastructure/github-octokit.client'
import { GitHubImportController } from './presentation/github-import.controller'

@Module({
	controllers: [GitHubImportController],
	providers: [GitHubImportService, GitHubImportRepository, GitHubOctokitClient],
	exports: [GitHubImportService],
})
export class GitHubImportModule {}
