import { status } from '@grpc/grpc-js'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { ClientGrpc } from '@nestjs/microservices'
import type { RepositoryId } from '@repo/domain'
import { firstValueFrom } from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import {
	GIT_STORAGE_SERVICE_NAME,
	type GitStorageServiceClient,
	type HealthResponse,
} from './generated/tessera/git/v1/git_storage'

export const GIT_STORAGE_GRPC_CLIENT = Symbol('GIT_STORAGE_GRPC_CLIENT')

export interface GitStorageCreateRepositoryParams {
	repositoryId: RepositoryId
}

export interface GitStorageCreateRepositoryResult {
	storagePath: string
}

@Injectable()
export class GitStorageClient implements OnModuleInit {
	private service!: GitStorageServiceClient

	constructor(
		@Inject(GIT_STORAGE_GRPC_CLIENT)
		private readonly client: ClientGrpc
	) {}

	onModuleInit() {
		this.service = this.client.getService<GitStorageServiceClient>(
			GIT_STORAGE_SERVICE_NAME
		)
	}

	async health(): Promise<HealthResponse> {
		try {
			return await firstValueFrom(this.service.health({}))
		} catch (error) {
			throw toGitStorageError(error)
		}
	}

	async createRepository({
		repositoryId,
	}: GitStorageCreateRepositoryParams): Promise<GitStorageCreateRepositoryResult> {
		try {
			const response = await firstValueFrom(
				this.service.createRepository({ repositoryId })
			)

			if (!response.storagePath)
				throw new ExternalServiceError('git storage', {
					repositoryId,
					reason: 'missing_storage_path',
				})

			return { storagePath: response.storagePath }
		} catch (error) {
			throw toGitStorageError(error)
		}
	}
}

function toGitStorageError(error: unknown) {
	if (error instanceof ExternalServiceError) return error

	const grpcCode = getGrpcCode(error)

	if (grpcCode === status.DEADLINE_EXCEEDED)
		return new GatewayTimeoutError('git storage', { grpcCode }, undefined, {
			cause: error,
		})

	if (grpcCode === status.UNAVAILABLE)
		return new ServiceUnavailableError('git storage', { grpcCode }, undefined, {
			cause: error,
		})

	return new ExternalServiceError('git storage', { grpcCode }, undefined, {
		cause: error,
	})
}

function getGrpcCode(error: unknown) {
	if (!error || typeof error !== 'object' || !('code' in error))
		return undefined

	const code = (error as { code: unknown }).code

	return typeof code === 'number' ? code : undefined
}
