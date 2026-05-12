import { GitStorageModule } from '@config/git-storage'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { RepositoriesController } from './presentation/repositories.controller'
import { RepositoryOwnerGuard } from './presentation/repository-owner.guard'

@Module({
	imports: [GitStorageModule, UserModule],
	controllers: [RepositoriesController],
	providers: [
		RepositoriesService,
		RepositoriesRepository,
		RepositoryOwnerGuard,
	],
	exports: [RepositoriesService],
})
export class RepositoriesModule {}
