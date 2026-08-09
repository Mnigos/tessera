import { EnvService } from '@config/env'
import { Metadata, status } from '@grpc/grpc-js'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { ClientGrpc } from '@nestjs/microservices'
import {
	catchError,
	firstValueFrom,
	type OperatorFunction,
	TimeoutError,
	throwError,
	timeout,
} from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import {
	type CheckRepositoryMergeabilityResponse,
	type CompareRepositoryRefsResponse,
	type CreateRepositoryResponse,
	type FindRepositoryMergeReceiptResponse,
	type GetRepositoryBlobResponse,
	type GetRepositoryBrowserSummaryResponse,
	type GetRepositoryFileDiffResponse,
	type GetRepositoryRawBlobResponse,
	type GetRepositoryTreeResponse,
	GIT_STORAGE_SERVICE_NAME,
	type GitStorageServiceClient,
	type HealthResponse,
	type ImportRepositoryResponse,
	type ListRepositoryCommitsResponse,
	type ListRepositoryRefsResponse,
	type MergeRepositoryRefsResponse,
	type PushRepositoryMirrorResponse,
} from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageCheckRepositoryMergeabilityParams,
	GitStorageCompareRepositoryRefsParams,
	GitStorageCreateRepositoryParams,
	GitStorageCreateRepositoryResult,
	GitStorageFindMergeReceiptParams,
	GitStorageGetRepositoryBlobParams,
	GitStorageGetRepositoryBrowserSummaryParams,
	GitStorageGetRepositoryFileDiffParams,
	GitStorageGetRepositoryRawBlobParams,
	GitStorageGetRepositoryTreeParams,
	GitStorageImportRepositoryParams,
	GitStorageImportRepositoryResult,
	GitStorageListRepositoryCommitsParams,
	GitStorageListRepositoryRefsParams,
	GitStorageMergeRepositoryRefsParams,
	GitStoragePushRepositoryMirrorParams,
	GitStorageRepositoryBlob,
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryCommitHistory,
	GitStorageRepositoryComparison,
	GitStorageRepositoryFileDiff,
	GitStorageRepositoryMergeability,
	GitStorageRepositoryRawBlob,
	GitStorageRepositoryRefs,
	GitStorageRepositoryTree,
} from './git-storage.client.types'
import {
	toProtoMergeStrategy,
	toRepositoryBlob,
	toRepositoryBrowserSummary,
	toRepositoryCommitHistory,
	toRepositoryComparison,
	toRepositoryFileDiff,
	toRepositoryMergeability,
	toRepositoryRawBlob,
	toRepositoryRefs,
	toRepositoryTree,
} from './git-storage.mappers'
import { getGrpcCode, getGrpcDetails } from './helpers/grpc-error'

export const GIT_STORAGE_GRPC_CLIENT = Symbol('GIT_STORAGE_GRPC_CLIENT')
/**
 * How long a merge or a mergeability answer may take.
 *
 * One ordering has to hold across three layers, innermost first: git storage's
 * own operation timeout, then this deadline, then the merge intent lease. The
 * innermost must fire first, so an overrunning merge comes back as a refusal
 * from the layer that knows what happened rather than being abandoned by a
 * caller that gave up while Git was still working — and the intent must outlive
 * both, or a concurrent close can delete the record of a merge still in flight.
 *
 * Git storage's side is `MERGE_OPERATION_TIMEOUT` in `services/git`;
 * `MERGE_INTENT_LEASE_MS` in the merge runner holds the other end, and a unit
 * test there asserts this pair.
 */
export const MERGE_RPC_TIMEOUT_MS = 50_000

@Injectable()
export class GitStorageClient implements OnModuleInit {
	private service!: GitStorageServiceClient

	constructor(
		@Inject(GIT_STORAGE_GRPC_CLIENT)
		private readonly client: ClientGrpc,
		private readonly envService: EnvService
	) {}

	onModuleInit() {
		this.service = this.client.getService<GitStorageServiceClient>(
			GIT_STORAGE_SERVICE_NAME
		)
	}

	async health(): Promise<HealthResponse> {
		return await firstValueFrom(
			this.service
				.health({}, this.createAuthorizationMetadata())
				.pipe(mapGitStorageErrors())
		)
	}

	async createRepository({
		repositoryId,
	}: GitStorageCreateRepositoryParams): Promise<GitStorageCreateRepositoryResult> {
		const response = await firstValueFrom(
			this.service
				.createRepository({ repositoryId }, this.createAuthorizationMetadata())
				.pipe(mapGitStorageErrors<CreateRepositoryResponse>())
		)

		if (!response.storagePath)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'missing_storage_path',
			})

		return { storagePath: response.storagePath }
	}

	async importRepository({
		accessToken,
		defaultBranchHint,
		repositoryId,
		sourceUrl,
		storagePath,
	}: GitStorageImportRepositoryParams): Promise<GitStorageImportRepositoryResult> {
		const response = await firstValueFrom(
			this.service
				.importRepository(
					{
						repositoryId,
						storagePath,
						sourceUrl,
						accessToken,
						defaultBranchHint: defaultBranchHint ?? '',
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<ImportRepositoryResponse>())
		)

		if (!response.storagePath)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'missing_storage_path',
			})

		if (!response.defaultBranch)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'missing_default_branch',
			})

		return {
			defaultBranch: response.defaultBranch,
			storagePath: response.storagePath,
		}
	}

	async pushRepositoryMirror({
		accessToken,
		repositoryId,
		storagePath,
		targetUrl,
	}: GitStoragePushRepositoryMirrorParams): Promise<void> {
		const response = await firstValueFrom(
			this.service
				.pushRepositoryMirror(
					{
						repositoryId,
						storagePath,
						targetUrl,
						accessToken,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<PushRepositoryMirrorResponse>())
		)

		if (!response.success)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'push_repository_mirror_failed',
			})
	}

	async getRepositoryBrowserSummary({
		defaultBranch,
		ref,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryBrowserSummaryParams): Promise<GitStorageRepositoryBrowserSummary> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryBrowserSummary(
					{
						repositoryId,
						storagePath,
						defaultBranch,
						ref: ref ?? '',
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<GetRepositoryBrowserSummaryResponse>())
		)

		return toRepositoryBrowserSummary(response)
	}

	async listRepositoryRefs({
		repositoryId,
		storagePath,
		trustedGpgKeys,
	}: GitStorageListRepositoryRefsParams): Promise<GitStorageRepositoryRefs> {
		const response = await firstValueFrom(
			this.service
				.listRepositoryRefs(
					{
						repositoryId,
						storagePath,
						trustedGpgKeys,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<ListRepositoryRefsResponse>())
		)

		return toRepositoryRefs(response)
	}

	async getRepositoryTree({
		path,
		ref,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryTreeParams): Promise<GitStorageRepositoryTree> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryTree(
					{
						repositoryId,
						storagePath,
						ref,
						path,
					},
					this.createAuthorizationMetadata()
				)
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
				.getRepositoryBlob(
					{
						repositoryId,
						storagePath,
						objectId,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<GetRepositoryBlobResponse>())
		)

		return toRepositoryBlob(response)
	}

	async getRepositoryRawBlob({
		objectId,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryRawBlobParams): Promise<GitStorageRepositoryRawBlob> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryRawBlob(
					{
						repositoryId,
						storagePath,
						objectId,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<GetRepositoryRawBlobResponse>())
		)

		return toRepositoryRawBlob(response)
	}

	async listRepositoryCommits({
		limit,
		ref,
		repositoryId,
		storagePath,
		trustedGpgKeys,
	}: GitStorageListRepositoryCommitsParams): Promise<GitStorageRepositoryCommitHistory> {
		const response = await firstValueFrom(
			this.service
				.listRepositoryCommits(
					{
						repositoryId,
						storagePath,
						ref,
						limit: limit ?? 0,
						trustedGpgKeys,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<ListRepositoryCommitsResponse>())
		)

		return toRepositoryCommitHistory(response)
	}

	async compareRepositoryRefs({
		baseRef,
		headRef,
		repositoryId,
		storagePath,
	}: GitStorageCompareRepositoryRefsParams): Promise<GitStorageRepositoryComparison> {
		const response = await firstValueFrom(
			this.service
				.compareRepositoryRefs(
					{ repositoryId, storagePath, baseRef, headRef },
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<CompareRepositoryRefsResponse>())
		)

		return toRepositoryComparison(response)
	}

	async getRepositoryFileDiff({
		baseRef,
		headRef,
		path,
		repositoryId,
		storagePath,
	}: GitStorageGetRepositoryFileDiffParams): Promise<GitStorageRepositoryFileDiff> {
		const response = await firstValueFrom(
			this.service
				.getRepositoryFileDiff(
					{ repositoryId, storagePath, baseRef, headRef, path },
					this.createAuthorizationMetadata()
				)
				.pipe(mapGitStorageErrors<GetRepositoryFileDiffResponse>())
		)

		return toRepositoryFileDiff(response)
	}

	/** Where the target branch was left, whichever strategy put it there. */
	async mergeRepositoryRefs({
		authorEmail,
		authorName,
		baseRef,
		expectedBaseSha,
		expectedHeadSha,
		headRef,
		message,
		operationId,
		repositoryId,
		squashBody,
		squashTitle,
		storagePath,
		strategy,
	}: GitStorageMergeRepositoryRefsParams): Promise<string> {
		const response = await firstValueFrom(
			this.service
				.mergeRepositoryRefs(
					{
						repositoryId,
						storagePath,
						baseRef,
						headRef,
						expectedBaseSha,
						expectedHeadSha,
						authorName,
						authorEmail,
						message,
						operationId,
						strategy: toProtoMergeStrategy(strategy),
						squashTitle: squashTitle ?? '',
						squashBody: squashBody ?? '',
					},
					this.createAuthorizationMetadata()
				)
				.pipe(
					timeout(MERGE_RPC_TIMEOUT_MS),
					mapGitStorageErrors<MergeRepositoryRefsResponse>()
				)
		)
		// `mergeCommitSha` is the same value under the name it had when a merge
		// commit was the only possible result, and a git storage that predates
		// `resultingSha` still sends it.
		const resultingSha = response.resultingSha || response.mergeCommitSha

		if (!resultingSha)
			throw new ExternalServiceError('git storage', {
				repositoryId,
				reason: 'missing_merge_commit_sha',
			})

		return resultingSha
	}

	/**
	 * Where a merge operation already left the target, or nothing when it never
	 * ran. A read: it moves no ref and writes no object, which is what makes it
	 * safe to ask on behalf of an attempt nobody is watching any more.
	 */
	async findMergeReceipt({
		expectedBaseSha,
		expectedHeadSha,
		operationId,
		repositoryId,
		storagePath,
		strategy,
	}: GitStorageFindMergeReceiptParams): Promise<string | undefined> {
		const response = await firstValueFrom(
			this.service
				.findRepositoryMergeReceipt(
					{
						repositoryId,
						storagePath,
						operationId,
						strategy: toProtoMergeStrategy(strategy),
						expectedBaseSha,
						expectedHeadSha,
					},
					this.createAuthorizationMetadata()
				)
				.pipe(
					timeout(MERGE_RPC_TIMEOUT_MS),
					mapGitStorageErrors<FindRepositoryMergeReceiptResponse>()
				)
		)

		return response.found ? response.resultingSha : undefined
	}

	async checkRepositoryMergeability({
		baseRef,
		headRef,
		repositoryId,
		storagePath,
	}: GitStorageCheckRepositoryMergeabilityParams): Promise<GitStorageRepositoryMergeability> {
		const response = await firstValueFrom(
			this.service
				.checkRepositoryMergeability(
					{ repositoryId, storagePath, baseRef, headRef },
					this.createAuthorizationMetadata()
				)
				// Bounded like the merge it clears the way for. Every merge path waits
				// on this answer while holding the repository's merge lease, so a Git
				// service that never replies would otherwise park the whole queue for
				// as long as it stayed silent.
				.pipe(
					timeout(MERGE_RPC_TIMEOUT_MS),
					mapGitStorageErrors<CheckRepositoryMergeabilityResponse>()
				)
		)

		return toRepositoryMergeability(response)
	}

	private createAuthorizationMetadata() {
		const token = this.envService.get('INTERNAL_API_TOKEN')

		if (!token)
			throw new ExternalServiceError('git storage', {
				reason: 'missing_internal_api_token',
			})

		const metadata = new Metadata()
		metadata.set('authorization', `Bearer ${token}`)

		return metadata
	}
}

function mapGitStorageErrors<T>(): OperatorFunction<T, T> {
	return catchError(error => throwError(() => toGitStorageError(error)))
}

function toGitStorageError(error: unknown) {
	if (error instanceof ExternalServiceError) return error
	if (error instanceof TimeoutError)
		return new GatewayTimeoutError(
			'git storage',
			{ timeoutMs: MERGE_RPC_TIMEOUT_MS },
			undefined,
			{ cause: error }
		)

	const grpcCode = getGrpcCode(error)
	const grpcDetails = getGrpcDetails(error)

	if (grpcCode === status.DEADLINE_EXCEEDED)
		return new GatewayTimeoutError(
			'git storage',
			{ grpcCode, grpcDetails },
			undefined,
			{
				cause: error,
			}
		)

	if (grpcCode === status.UNAVAILABLE)
		return new ServiceUnavailableError(
			'git storage',
			{ grpcCode, grpcDetails },
			undefined,
			{
				cause: error,
			}
		)

	return new ExternalServiceError(
		'git storage',
		{ grpcCode, grpcDetails },
		undefined,
		{
			cause: error,
		}
	)
}
