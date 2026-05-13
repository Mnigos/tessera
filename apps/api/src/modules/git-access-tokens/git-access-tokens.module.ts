import { Module } from '@nestjs/common'
import { GitAccessTokensService } from './application/git-access-tokens.service'
import { GitAccessTokensRepository } from './infrastructure/git-access-tokens.repository'
import { GitAccessTokensController } from './presentation/git-access-tokens.controller'

@Module({
	controllers: [GitAccessTokensController],
	providers: [GitAccessTokensService, GitAccessTokensRepository],
	exports: [GitAccessTokensService],
})
export class GitAccessTokensModule {}
