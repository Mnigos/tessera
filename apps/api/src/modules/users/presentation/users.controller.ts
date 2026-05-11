import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { UsersService } from '../application/users.service'

@Controller()
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Implement(contract.users.me)
	getViewer(@Session() session?: UserSession) {
		return implement(contract.users.me).handler(() =>
			this.usersService.getViewer(session)
		)
	}
}
