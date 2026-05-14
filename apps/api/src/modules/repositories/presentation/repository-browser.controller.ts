import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { RepositoriesService } from '../application/repositories.service'

@Controller()
export class RepositoryBrowserController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Implement(contract.repositories.getBrowserSummary)
	getBrowserSummary(@Session() session?: UserSession) {
		return implement(contract.repositories.getBrowserSummary).handler(
			({ input }) =>
				this.repositoriesService.getBrowserSummary(session?.user.id, input)
		)
	}

	@Implement(contract.repositories.getTree)
	getTree(@Session() session?: UserSession) {
		return implement(contract.repositories.getTree).handler(({ input }) =>
			this.repositoriesService.getTree(session?.user.id, input)
		)
	}

	@Implement(contract.repositories.getBlob)
	getBlob(@Session() session?: UserSession) {
		return implement(contract.repositories.getBlob).handler(({ input }) =>
			this.repositoriesService.getBlob(session?.user.id, input)
		)
	}

	@Implement(contract.repositories.getRawBlob)
	getRawBlob(@Session() session?: UserSession) {
		return implement(contract.repositories.getRawBlob).handler(
			async ({ input }) => {
				const content = await this.repositoriesService.getRawBlob(
					session?.user.id,
					input
				)

				return new File([content], getRawBlobFilename(input.path), {
					type: 'application/octet-stream',
				})
			}
		)
	}
}

function getRawBlobFilename(path: string) {
	return encodeURIComponent(path.split('/').at(-1) || 'blob')
}
