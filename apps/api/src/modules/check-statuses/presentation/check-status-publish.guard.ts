import { RepositoriesService } from '@modules/repositories'
import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import type { RepositorySlug } from '@repo/domain'
import type { AppRequest } from '~/shared/types/app-request'
import { CheckStatusProvidersService } from '../application/check-status-providers.service'
import {
	CheckStatusRepositoryMismatchError,
	InvalidCheckStatusCredentialError,
} from '../domain/check-status-credential.errors'
import { CheckStatusProvidersRepository } from '../infrastructure/check-status-providers.repository'
import { setCheckStatusAuthorization } from './check-status-authorization.context'

const BEARER_SCHEME = /^bearer\s+(?<token>\S+)$/i

/**
 * Admits an external publisher to exactly one repository.
 *
 * Every step is a refusal by default. The secret has to authenticate, carry
 * `checks:write`, and still be a live credential; the credential names its
 * provider and the provider names the one repository it may write to, and that
 * repository has to be the one in the path. Nothing the caller sends
 * participates in deciding who it is — the path only ever narrows what an
 * already-established identity is allowed to touch.
 */
@Injectable()
export class CheckStatusPublishGuard implements CanActivate {
	constructor(
		private readonly checkStatusProvidersService: CheckStatusProvidersService,
		private readonly checkStatusProvidersRepository: CheckStatusProvidersRepository,
		private readonly repositoriesService: RepositoriesService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AppRequest>()
		const username = request.params?.username
		const slug = request.params?.slug

		if (!(username && slug))
			throw new InvalidCheckStatusCredentialError({ reason: 'missing_target' })

		const apiKeyId = await this.checkStatusProvidersService.verifyCredential(
			toBearerToken(request)
		)
		const authorization =
			await this.checkStatusProvidersRepository.findAuthorization(apiKeyId)

		if (!authorization)
			throw new InvalidCheckStatusCredentialError({ reason: 'revoked_token' })

		// Resolving the repository from the path and comparing identities is what
		// confines the credential. Every way of failing here answers the same:
		// a path naming no repository, a path naming somebody else's, and a
		// repository GitHub is authoritative for — where checks are an import and
		// a native write would sit beside GitHub's results claiming equal standing.
		// One refusal for all three keeps a valid credential from becoming a way to
		// find out which repositories exist or how they are configured.
		const target = await this.repositoriesService.findRepositoryTargetByPath({
			username,
			slug: slug as RepositorySlug,
		})

		if (
			!target?.tesseraWritesAllowed ||
			authorization.repositoryId !== target.repositoryId
		)
			throw new CheckStatusRepositoryMismatchError({ slug, username })

		setCheckStatusAuthorization(request, authorization)

		return true
	}
}

function toBearerToken(request: AppRequest): string | undefined {
	const authorization = request.headers?.authorization

	return authorization?.match(BEARER_SCHEME)?.groups?.token
}
