import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { SshPublicKeysService } from '../application/ssh-public-keys.service'

@Controller()
@RequireAuth()
export class SshPublicKeysController {
	constructor(private readonly sshPublicKeysService: SshPublicKeysService) {}

	@Implement(contract.sshPublicKeys.create)
	create(@Session() session: UserSession) {
		return implement(contract.sshPublicKeys.create).handler(
			async ({ input }) => ({
				sshPublicKey: await this.sshPublicKeysService.create(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.sshPublicKeys.list)
	list(@Session() session: UserSession) {
		return implement(contract.sshPublicKeys.list).handler(async () => ({
			sshPublicKeys: await this.sshPublicKeysService.list(session.user.id),
		}))
	}

	@Implement(contract.sshPublicKeys.revoke)
	revoke(@Session() session: UserSession) {
		return implement(contract.sshPublicKeys.revoke).handler(
			async ({ input }) => {
				await this.sshPublicKeysService.revoke(session.user.id, input.id)

				return { success: true }
			}
		)
	}

	@Implement(contract.sshPublicKeys.delete)
	delete(@Session() session: UserSession) {
		return implement(contract.sshPublicKeys.delete).handler(
			async ({ input }) => {
				await this.sshPublicKeysService.delete(session.user.id, input.id)

				return { success: true }
			}
		)
	}
}
