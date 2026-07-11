import {
	type AuthenticateSshKeyRequest,
	type AuthenticateSshKeyResponse,
	type AuthorizeReadRequest,
	type AuthorizeReadResponse,
	type AuthorizeSshReadRequest,
	type AuthorizeSshReadResponse,
	type AuthorizeSshWriteRequest,
	type AuthorizeSshWriteResponse,
	type AuthorizeWriteRequest,
	type AuthorizeWriteResponse,
	GIT_AUTHORIZATION_SERVICE_NAME,
	type GitAuthorizationServiceController,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Controller, UseFilters, UseGuards } from '@nestjs/common'
import { GrpcMethod } from '@nestjs/microservices'
import type { RepositorySlug } from '@repo/domain'
import { RepositoriesService } from '../application/repositories.service'
import { toGitAuthorizationGrpcException } from './git-authorization.grpc-error'
import { GitAuthorizationGrpcExceptionFilter } from './git-authorization.grpc-exception.filter'
import { GitRepositoryWriteGuard } from './git-repository-write.guard'
import { getGitRepositoryWriteAuthorization } from './git-repository-write-authorization.context'
import { InternalGitAuthorizationGuard } from './internal-git-authorization.guard'

@Controller()
@UseGuards(InternalGitAuthorizationGuard)
@UseFilters(GitAuthorizationGrpcExceptionFilter)
export class GitAuthorizationGrpcController
	implements GitAuthorizationServiceController
{
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeRead')
	async authorizeRead(
		request: AuthorizeReadRequest
	): Promise<AuthorizeReadResponse> {
		try {
			return await this.repositoriesService.authorizeGitRepositoryRead({
				username: request.ownerUsername,
				slug: request.repositorySlug as RepositorySlug,
			})
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeWrite')
	@UseGuards(GitRepositoryWriteGuard)
	authorizeWrite(request: AuthorizeWriteRequest): AuthorizeWriteResponse {
		try {
			return getGitRepositoryWriteAuthorization(request)
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authenticateSshKey')
	async authenticateSshKey(
		request: AuthenticateSshKeyRequest
	): Promise<AuthenticateSshKeyResponse> {
		try {
			return await this.repositoriesService.authenticateSshKey({
				username: request.username,
				fingerprint: request.fingerprint,
			})
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeSshRead')
	async authorizeSshRead(
		request: AuthorizeSshReadRequest
	): Promise<AuthorizeSshReadResponse> {
		try {
			return await this.repositoriesService.authorizeSshGitRepositoryRead({
				username: request.ownerUsername,
				slug: request.repositorySlug as RepositorySlug,
				fingerprint: request.fingerprint,
			})
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeSshWrite')
	@UseGuards(GitRepositoryWriteGuard)
	authorizeSshWrite(
		request: AuthorizeSshWriteRequest
	): AuthorizeSshWriteResponse {
		try {
			return getGitRepositoryWriteAuthorization(request)
		} catch (error) {
			throw toGitAuthorizationGrpcException(error)
		}
	}
}
