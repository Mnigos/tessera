import { RepositoriesModule, RepositoryAdminGuard } from '@modules/repositories'
import { Module } from '@nestjs/common'
import { BranchProtectionService } from './application/branch-protection.service'
import { BranchProtectionRepository } from './infrastructure/branch-protection.repository'
import { BranchProtectionController } from './presentation/branch-protection.controller'

@Module({
	imports: [RepositoriesModule],
	controllers: [BranchProtectionController],
	providers: [
		BranchProtectionService,
		BranchProtectionRepository,
		RepositoryAdminGuard,
	],
	exports: [BranchProtectionService],
})
export class BranchProtectionModule {}
