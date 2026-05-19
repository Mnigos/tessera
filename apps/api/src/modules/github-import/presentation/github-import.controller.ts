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
}
