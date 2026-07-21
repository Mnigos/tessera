import type { AuthorizeWriteRequest } from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
} from '@nestjs/common'
import type { RepositorySlug, UserId } from '@repo/domain'
import { RepositoriesService } from '../application/repositories.service'
import { toGitAuthorizationGrpcException } from './git-authorization.grpc-error'
import {
	type GitRepositoryWriteRequest,
	setGitRepositoryWriteAuthorization,
} from './git-repository-write-authorization.context'

@Injectable()
export class GitRepositoryWriteGuard implements CanActivate {
	constructor(
		private readonly gitAccessTokensService: GitAccessTokensService,
		private readonly sshPublicKeysService: SshPublicKeysService,
		private readonly repositoriesService: RepositoriesService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToRpc().getData<GitRepositoryWriteRequest>()

		try {
			const trustedUserId = await this.resolveTrustedUserId(request)
			const authorization =
				await this.repositoriesService.authorizeGitRepositoryWrite(
					{
						username: request.ownerUsername,
						slug: request.repositorySlug as RepositorySlug,
					},
					trustedUserId
				)
			setGitRepositoryWriteAuthorization(request, authorization)

			return true
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}

	private async resolveTrustedUserId(
		request: GitRepositoryWriteRequest
	): Promise<UserId> {
		if (isHttpWriteRequest(request)) {
			const { userId } = await this.gitAccessTokensService.verify({
				rawToken: request.token,
				requiredPermission: 'git:write',
			})

			return userId
		}

		return await this.sshPublicKeysService.findOwnerByFingerprint(
			request.fingerprint
		)
	}
}

function isHttpWriteRequest(
	request: GitRepositoryWriteRequest
): request is AuthorizeWriteRequest {
	return 'token' in request
}
