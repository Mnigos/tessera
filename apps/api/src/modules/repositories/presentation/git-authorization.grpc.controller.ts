import {
	type AuthorizeReadRequest,
	type AuthorizeReadResponse,
	type AuthorizeWriteRequest,
	type AuthorizeWriteResponse,
	GIT_AUTHORIZATION_SERVICE_NAME,
	type GitAuthorizationServiceController,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { type Metadata, status } from '@grpc/grpc-js'
import { Controller } from '@nestjs/common'
import { GrpcMethod, RpcException } from '@nestjs/microservices'
import type { RepositorySlug } from '@repo/domain'
import { DomainError } from '~/shared/errors/domain.error'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'

@Controller()
export class GitAuthorizationGrpcController
	implements GitAuthorizationServiceController
{
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeRead')
	async authorizeRead(
		request: AuthorizeReadRequest,
		metadata?: Metadata
	): Promise<AuthorizeReadResponse> {
		try {
			return await this.repositoriesService.authorizeGitRepositoryRead({
				internalAuthorization: getAuthorization(metadata),
				username: request.ownerUsername,
				slug: request.repositorySlug as RepositorySlug,
			})
		} catch (error) {
			throw toGrpcException(error)
		}
	}

	@GrpcMethod(GIT_AUTHORIZATION_SERVICE_NAME, 'authorizeWrite')
	async authorizeWrite(
		request: AuthorizeWriteRequest,
		metadata?: Metadata
	): Promise<AuthorizeWriteResponse> {
		try {
			return await this.repositoriesService.authorizeGitRepositoryWrite({
				internalAuthorization: getAuthorization(metadata),
				username: request.ownerUsername,
				slug: request.repositorySlug as RepositorySlug,
				rawToken: request.token,
			})
		} catch (error) {
			throw toGrpcException(error)
		}
	}
}

function getAuthorization(metadata: Metadata | undefined): string | undefined {
	const [authorization] = metadata?.get('authorization') ?? []

	return typeof authorization === 'string' ? authorization : undefined
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
