import { contract } from '@config/rpc'
import { Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { AuthService } from '../application/auth.service'

@Controller()
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Implement(contract.auth.session)
	getSession(@Session() session?: UserSession) {
		return implement(contract.auth.session).handler(() =>
			this.authService.getSession(session)
		)
	}
}
