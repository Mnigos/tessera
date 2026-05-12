import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import type { AppRequest } from '~/shared/types/app-request'
import { RepositoryNotFoundError } from '../domain/repository.errors'

@Injectable()
export class RepositoryOwnerGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<AppRequest>()
		const requestedUsername = request.params?.username
		const currentUsername = request.session?.user.username

		if (!currentUsername) throw new RepositoryNotFoundError()

		if (requestedUsername !== currentUsername)
			throw new RepositoryNotFoundError({ username: requestedUsername })

		return true
	}
}
