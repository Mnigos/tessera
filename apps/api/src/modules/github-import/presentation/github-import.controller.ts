import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { GitHubImportService } from '../application/github-import.service'

@Controller()
@RequireAuth()
export class GitHubImportController {
	constructor(private readonly githubImportService: GitHubImportService) {}

	@Implement(contract.githubImport.listRepositories)
	listRepositories(@Session() session: UserSession) {
		return implement(contract.githubImport.listRepositories).handler(
			async () => ({
				repositories: await this.githubImportService.listRepositories(
					session.user.id
				),
			})
		)
	}

	@Implement(contract.githubImport.createImport)
	createImport(@Session() session: UserSession) {
		return implement(contract.githubImport.createImport).handler(
			async ({ input }) => ({
				import: await this.githubImportService.createImport(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.githubImport.listImports)
	listImports(@Session() session: UserSession) {
		return implement(contract.githubImport.listImports).handler(async () => ({
			imports: await this.githubImportService.listImports(session.user.id),
		}))
	}

	@Implement(contract.githubImport.getImport)
	getImport(@Session() session: UserSession) {
		return implement(contract.githubImport.getImport).handler(
			async ({ input }) => ({
				import: await this.githubImportService.getImport(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.githubImport.retryImport)
	retryImport(@Session() session: UserSession) {
		return implement(contract.githubImport.retryImport).handler(
			async ({ input }) => ({
				import: await this.githubImportService.retryImport(
					session.user.id,
					input
				),
			})
		)
	}
}
