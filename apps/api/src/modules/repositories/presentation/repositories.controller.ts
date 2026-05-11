import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { RepositoriesService } from '../application/repositories.service'

@Controller()
export class RepositoriesController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Implement(contract.repositories.listForViewer)
	listForViewer(@Session() session?: UserSession) {
		return implement(contract.repositories.listForViewer).handler(() =>
			this.repositoriesService.listForViewer(session)
		)
	}
}
