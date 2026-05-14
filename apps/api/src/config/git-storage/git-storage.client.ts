import { status } from '@grpc/grpc-js'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { ClientGrpc } from '@nestjs/microservices'
import type { RepositoryId } from '@repo/domain'
import {
	catchError,
	firstValueFrom,
	type OperatorFunction,
	throwError,
} from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import {
	type CreateRepositoryResponse,
	type GetRepositoryBlobResponse,
	type GetRepositoryBrowserSummaryResponse,
	type GetRepositoryTreeResponse,
	GIT_STORAGE_SERVICE_NAME,
	type GitStorageServiceClient,
	type HealthResponse,
} from './generated/tessera/git/v1/git_storage'
import {
	toRepositoryBlob,
	toRepositoryBrowserSummary,
	toRepositoryTree,
} from './git-storage.helpers'

export const GIT_STORAGE_GRPC_CLIENT = Symbol('GIT_STORAGE_GRPC_CLIENT')

export interface GitStorageCreateRepositoryParams {
	repositoryId: RepositoryId
}

export interface GitStorageCreateRepositoryResult {
	storagePath: string
}

export interface GitStorageGetRepositoryBrowserSummaryParams {
	defaultBranch: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageGetRepositoryTreeParams {
	path: string
	ref: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageGetRepositoryBlobParams {
	objectId: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageRepositoryTreeEntry {
	kind: 'directory' | 'file' | 'submodule' | 'symlink' | 'unknown'
	mode: string
	name: string
	objectId: string
	path: string
	sizeBytes: number
}

export interface GitStorageRepositoryReadme {
	content: string
	filename: string
	isTruncated: boolean
	objectId: string
}

export interface GitStorageRepositoryBrowserSummary {
	defaultBranch: string
	isEmpty: boolean
	readme?: GitStorageRepositoryReadme
	rootEntries: GitStorageRepositoryTreeEntry[]
}

export interface GitStorageRepositoryTree {
	commitId: string
	entries: GitStorageRepositoryTreeEntry[]
	path: string
}

export type GitStorageRepositoryBlobPreview =
	| { type: 'text'; content: string }
	| { type: 'binary' }
	| { type: 'tooLarge'; previewLimitBytes: number }

export interface GitStorageRepositoryBlob {
	objectId: string
	preview: GitStorageRepositoryBlobPreview
	sizeBytes: number
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
		return await firstValueFrom(
			this.service.health({}).pipe(mapGitStorageErrors())
		)
	}

	async createRepository({
		repositoryId,
	}: GitStorageCreateRepositoryParams): Promise<GitStorageCreateRepositoryResult> {
		const response = await firstValueFrom(
			this.service
				.createRepository({ repositoryId })
				.pipe(mapGitStorageErrors<CreateRepositoryResponse>())
		)

		if (!response.storagePath)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'missing_storage_path',
			})

		return { storagePath: response.storagePath }
	}

	async getRepositoryBrowserSummary({
		defaultBranch,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryBrowserSummaryParams): Promise<GitStorageRepositoryBrowserSummary> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryBrowserSummary({
					repositoryId,
					storagePath,
					defaultBranch,
				})
				.pipe(mapGitStorageErrors<GetRepositoryBrowserSummaryResponse>())
		)

		return toRepositoryBrowserSummary(response)
	}

	async getRepositoryTree({
		path,
		ref,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryTreeParams): Promise<GitStorageRepositoryTree> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryTree({
					repositoryId,
					storagePath,
					ref,
					path,
				})
				.pipe(mapGitStorageErrors<GetRepositoryTreeResponse>())
		)

		return toRepositoryTree(response)
	}

	async getRepositoryBlob({
		objectId,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryBlobParams): Promise<GitStorageRepositoryBlob> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryBlob({
					repositoryId,
					storagePath,
					objectId,
				})
				.pipe(mapGitStorageErrors<GetRepositoryBlobResponse>())
		)

		return toRepositoryBlob(response)
	}
}

function mapGitStorageErrors<T>(): OperatorFunction<T, T> {
	return catchError(error => throwError(() => toGitStorageError(error)))
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
