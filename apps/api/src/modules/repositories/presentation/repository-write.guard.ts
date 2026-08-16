import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import type { RepositorySlug } from '@repo/domain'
import type { AppRequest } from '~/shared/types/app-request'
import { RepositoriesService } from '../application/repositories.service'
import {
	RepositoryNotFoundError,
	RepositoryOwnerUsernameRequiredError,
} from '../domain/repository.errors'

@Injectable()
export class RepositoryWriteGuard implements CanActivate {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AppRequest>()
		const username = request.params?.username
		const slug = request.params?.slug
		const viewerUserId = request.session?.user.id

		if (!username) throw new RepositoryOwnerUsernameRequiredError()
		if (!slug) throw new RepositoryNotFoundError({ username })
		if (!viewerUserId) throw new RepositoryNotFoundError({ username })

		await this.repositoriesService.assertViewerRepositoryWriteAccess(
			viewerUserId,
			{ username, slug: slug as RepositorySlug }
		)

		return true
	}
}
