import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { OrganizationsService } from '../application/organizations.service'

@Controller()
export class OrganizationsController {
	constructor(private readonly organizationsService: OrganizationsService) {}

	@Implement(contract.organizations.list)
	list(@Session() session?: UserSession) {
		return implement(contract.organizations.list).handler(() =>
			this.organizationsService.listForViewer(session)
		)
	}
}
