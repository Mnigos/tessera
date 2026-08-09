import { ChecksModule } from '@modules/checks'
import { RepositoriesModule, RepositoryAdminGuard } from '@modules/repositories'
import { Module } from '@nestjs/common'
import { CheckStatusProvidersService } from './application/check-status-providers.service'
import { CheckStatusProvidersRepository } from './infrastructure/check-status-providers.repository'
import { CheckStatusProvidersController } from './presentation/check-status-providers.controller'
import { CheckStatusPublishGuard } from './presentation/check-status-publish.guard'
import { CheckStatusesController } from './presentation/check-statuses.controller'

/**
 * Who outside Tessera may write to the ledger, and the route they write
 * through.
 *
 * It sits beside the ledger rather than inside it because admitting a publisher
 * is a repository decision: this is the one place that needs both the checks
 * module and the repository module, and keeping it here is what lets those two
 * stay in one direction.
 */
@Module({
	imports: [ChecksModule, RepositoriesModule],
	controllers: [CheckStatusesController, CheckStatusProvidersController],
	providers: [
		CheckStatusProvidersRepository,
		CheckStatusProvidersService,
		CheckStatusPublishGuard,
		RepositoryAdminGuard,
	],
})
export class CheckStatusesModule {}
