import { contract } from '@config/rpc'
import { RequireAuth, Session, type UserSession } from '@modules/auth'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { GpgPublicKeysService } from '../application/gpg-public-keys.service'

@Controller()
@RequireAuth()
export class GpgPublicKeysController {
	constructor(private readonly gpgPublicKeysService: GpgPublicKeysService) {}

	@Implement(contract.gpgPublicKeys.create)
	create(@Session() session: UserSession) {
		return implement(contract.gpgPublicKeys.create).handler(
			async ({ input }) => ({
				gpgPublicKey: await this.gpgPublicKeysService.create(
					session.user.id,
					input
				),
			})
		)
	}

	@Implement(contract.gpgPublicKeys.list)
	list(@Session() session: UserSession) {
		return implement(contract.gpgPublicKeys.list).handler(async () => ({
			gpgPublicKeys: await this.gpgPublicKeysService.list(session.user.id),
		}))
	}

	@Implement(contract.gpgPublicKeys.delete)
	delete(@Session() session: UserSession) {
		return implement(contract.gpgPublicKeys.delete).handler(
			async ({ input }) => {
				await this.gpgPublicKeysService.delete(session.user.id, input.id)

				return { success: true }
			}
		)
	}
}
