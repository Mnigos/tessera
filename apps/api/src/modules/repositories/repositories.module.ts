import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryOwnerGuard } from './presentation/repository-owner.guard'

@Module({
	controllers: [RepositoriesController],
	providers: [
		RepositoriesService,
		RepositoriesRepository,
		RepositoryOwnerGuard,
	],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
