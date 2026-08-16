import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { HandlesService } from '../application/handles.service'

@Controller()
export class HandlesController {
	constructor(private readonly handlesService: HandlesService) {}

	@Implement(contract.handles.get)
	get(@Session() session?: UserSession) {
		return implement(contract.handles.get).handler(({ input }) =>
			this.handlesService.get(session?.user.id, input)
		)
	}
}
