import { UserService } from '@modules/user'
import { ProfileNotFoundError } from '@modules/user/domain/user.errors'
import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import type { AppRequest } from '~/shared/types/app-request'
import {
	RepositoryNotFoundError,
	RepositoryOwnerUsernameRequiredError,
} from '../domain/repository.errors'

@Injectable()
export class RepositoryOwnerGuard implements CanActivate {
	constructor(private readonly userService: UserService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AppRequest>()
		const requestedUsername = request.params?.username
		const viewerUserId = request.session?.user.id

		if (!requestedUsername) throw new RepositoryOwnerUsernameRequiredError()

		if (!viewerUserId) throw new RepositoryNotFoundError()

		const targetUserId = await this.findTargetUserId(requestedUsername)

		request.targetUserId = targetUserId
		request.viewerUserId = viewerUserId

		if (targetUserId !== viewerUserId)
			throw new RepositoryNotFoundError({ username: requestedUsername })

		return true
	}

	private async findTargetUserId(username: string) {
		try {
			return await this.userService.findUserId({ username })
		} catch (error) {
			if (error instanceof ProfileNotFoundError)
				throw new RepositoryNotFoundError({ username })

			throw error
		}
	}
}
