import { contract } from '@config/rpc'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { UserService } from '../application/user.service'

@Controller()
export class UserController {
	constructor(private readonly userService: UserService) {}

	@Implement(contract.user.profile)
	getProfile() {
		return implement(contract.user.profile).handler(({ input }) =>
			this.userService.getProfile(input)
		)
	}
}
