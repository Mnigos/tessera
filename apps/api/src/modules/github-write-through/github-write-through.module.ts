import { Module } from '@nestjs/common'
import { GitHubWriteThroughService } from './application/github-write-through.service'
import { GitHubUserWriteClient } from './infrastructure/github-user-write.client'
import { GitHubWriteThroughRepository } from './infrastructure/github-write-through.repository'

/** Depends on no other domain module: importing pull requests back would cycle. */
@Module({
	providers: [
		GitHubWriteThroughService,
		GitHubUserWriteClient,
		GitHubWriteThroughRepository,
	],
	exports: [GitHubWriteThroughService],
})
export class GitHubWriteThroughModule {}
