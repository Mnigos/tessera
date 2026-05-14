import {
	type AuthorizeReadRequest,
	type AuthorizeReadResponse,
	type AuthorizeWriteRequest,
	type AuthorizeWriteResponse,
	GIT_AUTHORIZATION_SERVICE_NAME,
	type GitAuthorizationServiceController,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { status } from '@grpc/grpc-js'
import { Controller, UseGuards } from '@nestjs/common'
import { GrpcMethod, RpcException } from '@nestjs/microservices'
import type { RepositorySlug } from '@repo/domain'
import { DomainError } from '~/shared/errors/domain.error'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'
import { InternalGitAuthorizationGuard } from './internal-git-authorization.guard'

@Controller()
@UseGuards(InternalGitAuthorizationGuard)
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
			throw toGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeWrite')
	async authorizeWrite(
		request: AuthorizeWriteRequest
	): Promise<AuthorizeWriteResponse> {
		try {
			return await this.repositoriesService.authorizeGitRepositoryWrite({
				username: request.ownerUsername,
				slug: request.repositorySlug as RepositorySlug,
				rawToken: request.token,
			})
		} catch (error) {
			throw toGrpcException(error)
		}
	}
}

function toGrpcException(error: unknown) {
	if (error instanceof RpcException) return error

	return new RpcException({
		code: getGrpcStatus(error),
		message: error instanceof Error ? error.message : 'Internal error',
	})
}

function getGrpcStatus(error: unknown) {
	if (!(error instanceof DomainError)) return status.INTERNAL

	if (error.code === 'UNAUTHORIZED') return status.UNAUTHENTICATED
	if (error.code === 'FORBIDDEN') return status.PERMISSION_DENIED
	if (error.code === 'NOT_FOUND') return status.NOT_FOUND
	if (error instanceof RepositoryStoragePathMissingError)
		return status.FAILED_PRECONDITION

	return status.INTERNAL
}
