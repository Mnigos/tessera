import { RepositoriesModule, RepositoryAdminGuard } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { RepositoryCollaboratorsService } from './application/repository-collaborators.service'
import { RepositoryCollaboratorsRepository } from './infrastructure/repository-collaborators.repository'
import { RepositoryCollaboratorsController } from './presentation/repository-collaborators.controller'

@Module({
	imports: [RepositoriesModule, UserModule],
	controllers: [RepositoryCollaboratorsController],
	providers: [
		RepositoryCollaboratorsService,
		RepositoryCollaboratorsRepository,
		RepositoryAdminGuard,
	],
	exports: [RepositoryCollaboratorsService],
})
export class RepositoryCollaboratorsModule {}
