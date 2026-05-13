import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { GitAccessTokensService } from '../application/git-access-tokens.service'

@Controller()
@RequireAuth()
export class GitAccessTokensController {
	constructor(
		private readonly gitAccessTokensService: GitAccessTokensService
	) {}

	@Implement(contract.gitAccessTokens.create)
	create(@Session() session: UserSession) {
		return implement(contract.gitAccessTokens.create).handler(({ input }) =>
			this.gitAccessTokensService.create(session.user.id, input)
		)
	}

	@Implement(contract.gitAccessTokens.list)
	list(@Session() session: UserSession) {
		return implement(contract.gitAccessTokens.list).handler(async () => ({
			accessTokens: await this.gitAccessTokensService.list(session.user.id),
		}))
	}

	@Implement(contract.gitAccessTokens.revoke)
	revoke(@Session() session: UserSession) {
		return implement(contract.gitAccessTokens.revoke).handler(
			async ({ input }) => {
				await this.gitAccessTokensService.revoke(session.user.id, input.id)

				return { success: true }
			}
		)
	}
}
