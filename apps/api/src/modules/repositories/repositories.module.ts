import { AuthModule } from '@modules/auth'
import { Module } from '@nestjs/common'
import { RepositoriesService } from './application/repositories.service'
import { RepositoriesRepository } from './infrastructure/repositories.repository'
import { RepositoriesController } from './presentation/repositories.controller'

@Module({
	imports: [AuthModule],
	controllers: [RepositoriesController],
	providers: [RepositoriesRepository, RepositoriesService],
	exports: [RepositoriesRepository, RepositoriesService],
})
export class RepositoriesModule {}
