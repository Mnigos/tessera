import {
	GitStorageClient,
	type GitStorageGetRepositoryBlobParams,
	type GitStorageGetRepositoryRawBlobParams,
	type GitStorageGetRepositoryTreeParams,
	type GitStorageListRepositoryCommitsParams,
	type GitStorageListRepositoryRefsParams,
	type GitStorageRepositoryBlob,
	type GitStorageRepositoryCommitHistory,
	type GitStorageRepositoryRawBlob,
	type GitStorageRepositoryRef,
	type GitStorageRepositoryRefs,
	type GitStorageRepositoryTree,
	type GitStorageTrustedGpgKey,
} from '@config/git-storage'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { GpgPublicKeysService } from '@modules/gpg-public-keys'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import { Injectable, Logger } from '@nestjs/common'
import type {
	CreateRepositoryInput,
	ParsedCutoverGitHubMirrorInput,
	ParsedDisableGitHubPushBackInput,
	ParsedEnableGitHubPushBackInput,
	ParsedGetRepositoryBlobInput,
	ParsedGetRepositoryBrowserSummaryInput,
	ParsedGetRepositoryCommitHistoryInput,
	ParsedGetRepositoryInput,
	ParsedGetRepositoryRefsInput,
	ParsedGetRepositoryTreeInput,
	ParsedPushGitHubPushBackMirrorInput,
	RepositoryBlob,
	RepositoryBlobPreview,
	RepositoryBrowserSummary,
	RepositoryCommitHistory,
	RepositoryRefs,
	RepositoryTree,
	RepositoryWithOwner,
} from '@repo/contracts'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	type RepositoryWithOwner as RepositoryWithOwnerEntity,
	toRepositoryOutput,
} from '../domain/repository'
import {
	DuplicateRepositorySlugError,
	PrivateRepositoryGitReadForbiddenError,
	RepositoryBrowserInvalidRequestError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryGitHubMirrorCutoverSyncInProgressError,
	RepositoryGitHubMirrorCutoverUnavailableError,
	RepositoryGitHubMirrorSyncUnavailableError,
	RepositoryGitHubPushBackDisabledError,
	RepositoryGitHubPushBackInProgressError,
	RepositoryGitHubPushBackTokenMissingError,
	RepositoryGitHubPushBackUnavailableError,
	RepositoryGitHubSourceOfTruthWriteForbiddenError,
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
	RepositoryStoragePathMissingError,
} from '../domain/repository.errors'
import {
	normalizeGeneratedRepositorySlug,
	normalizeRepositoryName,
	normalizeRepositorySlug,
} from '../domain/repository.helpers'
import { highlightRepositoryBlobPreview } from '../helpers/repository-blob-highlighting'
import {
	type RepositoryBrowserStorageErrorContext,
	toRepositoryBrowserReadError,
} from '../helpers/repository-browser-storage-error'
import { GitHubMirrorSyncQueue } from '../infrastructure/github-mirror-sync.queue'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

const REPOSITORY_SLUG_UNIQUE_CONSTRAINTS = new Set([
	'repositories_owner_user_slug_unique',
	'repositories_owner_organization_slug_unique',
])
const GITHUB_MIRROR_SYNC_ENQUEUE_FAILURE_REASON =
	'GitHub mirror sync could not be queued. Please retry.'

interface CreateRepositoryMetadataParams {
	description: string | undefined
	name: RepositoryName
	slug: RepositorySlug
	userId: UserId
	username: string
	visibility: CreateRepositoryInput['visibility']
}

export interface UpdateImportedRepositoryStorageParams {
	defaultBranch: string
	repositoryId: RepositoryId
	storagePath: string
	username: string
}

export interface InitializeGitHubExternalSourceInput {
	externalRepositoryId: bigint
	ownerLogin: string
	name: string
	fullName: string
	sourceUrl: string
	sourceDefaultBranch: string
	repositoryId: RepositoryId
	startedAt: Date | null
	completedAt: Date
}

interface CompleteImportedGitHubRepositoryInput
	extends UpdateImportedRepositoryStorageParams,
		InitializeGitHubExternalSourceInput {}

interface ReadableRepositoryContext {
	repository: RepositoryWithOwnerEntity
	storagePath: string
}

export interface AuthorizeGitRepositoryReadInput {
	slug: RepositorySlug
	username: string
}

export interface AuthorizeGitRepositoryWriteInput {
	rawToken: string | undefined
	slug: RepositorySlug
	username: string
}

export interface AuthorizeSshGitRepositoryInput {
	fingerprint: string
	slug: RepositorySlug
	username: string
}

export interface AuthenticateSshKeyInput {
	fingerprint: string
	username: string
}

export interface GitRepositoryAuthorization {
	repositoryId: RepositoryId
	storagePath: string
	trustedUser: string
}

export interface CreateImportedRepositoryMetadataInput {
	name: RepositoryName
	slug: RepositorySlug
	userId: UserId
	username: string
	visibility: CreateRepositoryInput['visibility']
}

@Injectable()
export class RepositoriesService {
	private readonly logger = new Logger(RepositoriesService.name)

	constructor(
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly gitStorageClient: GitStorageClient,
		private readonly gitAccessTokensService: GitAccessTokensService,
		private readonly gpgPublicKeysService: GpgPublicKeysService,
		private readonly sshPublicKeysService: SshPublicKeysService,
		private readonly githubMirrorSyncQueue: GitHubMirrorSyncQueue
	) {}

	async create(
		userId: UserId,
		currentUsername: string | undefined,
		{ description, visibility, ...input }: CreateRepositoryInput
	): Promise<RepositoryWithOwner> {
		if (!currentUsername) throw new RepositoryCreatorUsernameRequiredError()

		const name = normalizeRepositoryName(input.name)
		const slug = input.slug
			? normalizeRepositorySlug(input.slug)
			: normalizeGeneratedRepositorySlug(input.name)

		const repository = await this.createRepositoryMetadata({
			userId,
			name,
			slug,
			username: currentUsername,
			description,
			visibility,
		})

		try {
			const { storagePath } = await this.gitStorageClient.createRepository({
				repositoryId: repository.id,
			})
			const repositoryWithStorage =
				await this.repositoriesRepository.updateStoragePath({
					repositoryId: repository.id,
					storagePath,
					username: currentUsername,
				})

			if (!repositoryWithStorage) throw new RepositoryCreateFailedError()

			return toRepositoryOutput(repositoryWithStorage)
		} catch (error) {
			await this.cleanupCreatedRepository(repository.id)

			throw error
		}
	}

	async list(userId: UserId): Promise<RepositoryWithOwner[]> {
		const repositories = await this.repositoriesRepository.list({ userId })

		return repositories.map(toRepositoryOutput)
	}

	async createImportedRepositoryMetadata({
		name,
		slug,
		userId,
		username,
		visibility,
	}: CreateImportedRepositoryMetadataInput): Promise<RepositoryWithOwnerEntity> {
		return await this.createRepositoryMetadata({
			userId,
			name,
			slug,
			username,
			description: undefined,
			visibility,
		})
	}

	async updateImportedRepositoryStorage({
		defaultBranch,
		repositoryId,
		storagePath,
		username,
	}: UpdateImportedRepositoryStorageParams): Promise<
		RepositoryWithOwnerEntity | undefined
	> {
		return await this.repositoriesRepository.updateImportStorage({
			repositoryId,
			storagePath,
			defaultBranch,
			username,
		})
	}

	async initializeImportedGitHubExternalSource({
		completedAt,
		externalRepositoryId,
		fullName,
		name,
		ownerLogin,
		repositoryId,
		sourceDefaultBranch,
		sourceUrl,
		startedAt,
	}: InitializeGitHubExternalSourceInput): Promise<void> {
		await this.repositoriesRepository.upsertGitHubExternalSource({
			repositoryId,
			externalRepositoryId,
			ownerLogin,
			name,
			fullName,
			sourceUrl,
			sourceDefaultBranch,
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: startedAt ?? completedAt,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			syncFailureReason: undefined,
		})
	}

	async completeImportedGitHubRepository({
		completedAt,
		defaultBranch,
		externalRepositoryId,
		fullName,
		name,
		ownerLogin,
		repositoryId,
		sourceDefaultBranch,
		sourceUrl,
		startedAt,
		storagePath,
		username,
	}: CompleteImportedGitHubRepositoryInput): Promise<
		RepositoryWithOwnerEntity | undefined
	> {
		return await this.repositoriesRepository.completeImportedGitHubRepository({
			repositoryId,
			storagePath,
			defaultBranch,
			username,
			externalRepositoryId,
			ownerLogin,
			name,
			fullName,
			sourceUrl,
			sourceDefaultBranch,
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: startedAt ?? completedAt,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			syncFailureReason: undefined,
		})
	}

	async deleteRepositoryMetadata(repositoryId: RepositoryId): Promise<void> {
		await this.repositoriesRepository.delete({ repositoryId })
	}

	async get(
		userId: UserId,
		{ slug, username }: ParsedGetRepositoryInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		return toRepositoryOutput(repository)
	}

	async syncGitHubMirror(
		requesterUserId: UserId,
		targetUserId: UserId,
		{ slug, username }: ParsedGetRepositoryInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })
		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})
		if (
			repository.externalSource?.provider !== 'github' ||
			repository.externalSource.mirrorMode === 'tessera_source'
		)
			throw new RepositoryGitHubMirrorSyncUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource?.provider,
				mirrorMode: repository.externalSource?.mirrorMode,
			})

		const pendingRepository =
			await this.repositoriesRepository.markGitHubMirrorSyncPending({
				repositoryId: repository.id,
				userId: targetUserId,
			})

		if (!pendingRepository)
			throw new RepositoryNotFoundError({ repositoryId: repository.id })

		if (pendingRepository.didMarkPending)
			try {
				await this.githubMirrorSyncQueue.enqueueRepositorySync({
					repositoryId: repository.id,
					requesterUserId,
				})
			} catch (error) {
				this.logger.error(
					'Failed to enqueue GitHub mirror sync job',
					error instanceof Error ? error.stack : undefined
				)
				try {
					await this.repositoriesRepository.markGitHubMirrorSyncFailed({
						repositoryId: repository.id,
						failedAt: new Date(),
						failureReason: GITHUB_MIRROR_SYNC_ENQUEUE_FAILURE_REASON,
					})
				} catch (markError) {
					this.logger.error(
						'Failed to mark GitHub mirror sync as failed after enqueue error',
						markError instanceof Error ? markError.stack : undefined
					)
				}

				throw error
			}

		return toRepositoryOutput(pendingRepository.repository)
	}

	async cutoverGitHubMirror(
		actorUserId: UserId,
		targetUserId: UserId,
		{ slug, username }: ParsedCutoverGitHubMirrorInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })
		if (
			repository.externalSource?.provider !== 'github' ||
			repository.externalSource.mirrorMode !== 'github_to_tessera'
		)
			throw new RepositoryGitHubMirrorCutoverUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource?.provider,
				mirrorMode: repository.externalSource?.mirrorMode,
			})
		if (
			repository.externalSource.syncStatus === 'pending' ||
			repository.externalSource.syncStatus === 'running'
		)
			throw new RepositoryGitHubMirrorCutoverSyncInProgressError({
				repositoryId: repository.id,
				syncStatus: repository.externalSource.syncStatus,
			})
		if (repository.externalSource.syncStatus !== 'succeeded')
			throw new RepositoryGitHubMirrorCutoverUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource.provider,
				mirrorMode: repository.externalSource.mirrorMode,
				syncStatus: repository.externalSource.syncStatus,
			})

		const cutoverRepository =
			await this.repositoriesRepository.cutoverGitHubMirror({
				repositoryId: repository.id,
				userId: targetUserId,
				actorUserId,
				cutoverAt: new Date(),
			})

		if (!cutoverRepository)
			throw new RepositoryGitHubMirrorCutoverUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource.provider,
				mirrorMode: repository.externalSource.mirrorMode,
				syncStatus: repository.externalSource.syncStatus,
			})

		return toRepositoryOutput(cutoverRepository)
	}

	async enableGitHubPushBack(
		targetUserId: UserId,
		{ slug, username }: ParsedEnableGitHubPushBackInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		this.assertGitHubPushBackAvailable(repository)

		this.assertGitHubPushBackNotRunning(repository)

		const enabledRepository =
			await this.repositoriesRepository.enableGitHubPushBack({
				repositoryId: repository.id,
				userId: targetUserId,
			})

		if (!enabledRepository)
			throw new RepositoryGitHubPushBackUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource?.provider,
				mirrorMode: repository.externalSource?.mirrorMode,
			})

		return toRepositoryOutput(enabledRepository)
	}

	async disableGitHubPushBack(
		targetUserId: UserId,
		{ slug, username }: ParsedDisableGitHubPushBackInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		this.assertGitHubPushBackAvailable(repository)

		this.assertGitHubPushBackNotRunning(repository)

		const disabledRepository =
			await this.repositoriesRepository.disableGitHubPushBack({
				repositoryId: repository.id,
				userId: targetUserId,
			})

		if (!disabledRepository)
			throw new RepositoryGitHubPushBackUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource?.provider,
				mirrorMode: repository.externalSource?.mirrorMode,
			})

		return toRepositoryOutput(disabledRepository)
	}

	async pushGitHubPushBackMirror(
		targetUserId: UserId,
		{ slug, username }: ParsedPushGitHubPushBackMirrorInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		this.assertGitHubPushBackAvailable(repository)

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		if (!repository.externalSource?.githubPushBackEnabled)
			throw new RepositoryGitHubPushBackDisabledError({
				repositoryId: repository.id,
			})

		this.assertGitHubPushBackNotRunning(repository)

		const account = await this.repositoriesRepository.findGitHubAccount({
			userId: targetUserId,
		})

		if (!account?.accessToken)
			throw new RepositoryGitHubPushBackTokenMissingError({
				repositoryId: repository.id,
				userId: targetUserId,
			})

		const runningRepository =
			await this.repositoriesRepository.markGitHubPushBackRunning({
				repositoryId: repository.id,
				userId: targetUserId,
				startedAt: new Date(),
			})

		if (!runningRepository)
			throw new RepositoryGitHubPushBackInProgressError({
				repositoryId: repository.id,
			})

		try {
			await this.gitStorageClient.pushRepositoryMirror({
				repositoryId: repository.id,
				storagePath: repository.storagePath,
				targetUrl: repository.externalSource.sourceUrl,
				accessToken: account.accessToken,
			})
			await this.repositoriesRepository.markGitHubPushBackSucceeded({
				repositoryId: repository.id,
				succeededAt: new Date(),
			})
		} catch (error) {
			await this.markGitHubPushBackFailed(repository.id, error)
			throw error
		}

		const pushedRepository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!pushedRepository)
			throw new RepositoryNotFoundError({ repositoryId: repository.id })

		return toRepositoryOutput(pushedRepository)
	}

	async getBrowserSummary(
		viewerUserId: UserId | undefined,
		{ ref, slug, username }: ParsedGetRepositoryBrowserSummaryInput
	): Promise<RepositoryBrowserSummary> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const trustedGpgKeys = await this.listRepositoryOwnerTrustedGpgKeys(
			repository.ownerUserId
		)
		const refs = await this.getRepositoryRefsFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				trustedGpgKeys,
			},
			{
				username,
				slug,
				ref: ref ?? repository.defaultBranch,
				path: '',
			}
		)
		const selectedRef = this.resolveSelectedRef({
			refs,
			ref,
			defaultBranch: repository.defaultBranch,
			username,
			slug,
		})

		const browserSummary =
			await this.gitStorageClient.getRepositoryBrowserSummary({
				repositoryId: repository.id,
				storagePath,
				defaultBranch: repository.defaultBranch,
				ref: selectedRef?.qualifiedName ?? ref,
			})
		const repositoryOutput = toRepositoryOutput(repository)

		return {
			...repositoryOutput,
			...browserSummary,
			selectedRef,
			branches: refs.branches,
			tags: refs.tags,
		}
	}

	async getRefs(
		viewerUserId: UserId | undefined,
		{ slug, username }: ParsedGetRepositoryRefsInput
	): Promise<RepositoryRefs> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const trustedGpgKeys = await this.listRepositoryOwnerTrustedGpgKeys(
			repository.ownerUserId
		)
		const refs = await this.getRepositoryRefsFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				trustedGpgKeys,
			},
			{
				username,
				slug,
				ref: repository.defaultBranch,
				path: '',
			}
		)
		const repositoryOutput = toRepositoryOutput(repository)

		return {
			...repositoryOutput,
			branches: refs.branches,
			tags: refs.tags,
		}
	}

	async getTree(
		viewerUserId: UserId | undefined,
		{ path, ref, slug, username }: ParsedGetRepositoryTreeInput
	): Promise<RepositoryTree> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const tree = await this.getRepositoryTreeFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				ref,
				path: path ?? '',
			},
			{
				username,
				slug,
				ref,
				path: path ?? '',
			}
		)
		const repositoryOutput = toRepositoryOutput(repository)

		return {
			...repositoryOutput,
			ref,
			...tree,
		}
	}

	async getBlob(
		viewerUserId: UserId | undefined,
		{ path, ref, slug, username }: ParsedGetRepositoryBlobInput
	): Promise<RepositoryBlob> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const parentPath = getParentPath(path)
		const tree = await this.getRepositoryTreeFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				ref,
				path: parentPath,
			},
			{
				username,
				slug,
				ref,
				path,
			}
		)
		const entry = tree.entries.find(treeEntry => treeEntry.path === path)

		if (!entry || entry.kind !== 'file')
			throw new RepositoryNotFoundError({ slug, username })

		const blob = await this.getRepositoryBlobFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				objectId: entry.objectId,
			},
			{
				username,
				slug,
				ref,
				path,
			}
		)
		const repositoryOutput = toRepositoryOutput(repository)
		const preview = await this.enrichBlobPreview(path, blob.preview)

		return {
			...repositoryOutput,
			ref,
			path,
			name: entry.name,
			objectId: blob.objectId,
			sizeBytes: blob.sizeBytes,
			preview,
		}
	}

	async getRawBlob(
		viewerUserId: UserId | undefined,
		{ path, ref, slug, username }: ParsedGetRepositoryBlobInput
	): Promise<Uint8Array<ArrayBufferLike>> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const parentPath = getParentPath(path)
		const tree = await this.getRepositoryTreeFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				ref,
				path: parentPath,
			},
			{
				username,
				slug,
				ref,
				path,
			}
		)
		const entry = tree.entries.find(treeEntry => treeEntry.path === path)

		if (!entry || entry.kind !== 'file')
			throw new RepositoryNotFoundError({ slug, username })

		const blob = await this.getRepositoryRawBlobFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				objectId: entry.objectId,
			},
			{
				username,
				slug,
				ref,
				path,
			}
		)

		return blob.content
	}

	async getCommitHistory(
		viewerUserId: UserId | undefined,
		{ limit, ref, slug, username }: ParsedGetRepositoryCommitHistoryInput
	): Promise<RepositoryCommitHistory> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const trustedGpgKeys = await this.listRepositoryOwnerTrustedGpgKeys(
			repository.ownerUserId
		)
		const commitHistory = await this.getRepositoryCommitsFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				ref,
				limit,
				trustedGpgKeys,
			},
			{
				username,
				slug,
				ref,
				path: '',
			}
		)
		const repositoryOutput = toRepositoryOutput(repository)

		return {
			...repositoryOutput,
			ref,
			commits: commitHistory.commits,
		}
	}

	async authorizeGitRepositoryRead({
		slug,
		username,
	}: AuthorizeGitRepositoryReadInput): Promise<GitRepositoryAuthorization> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		if (repository.visibility === 'private')
			throw new PrivateRepositoryGitReadForbiddenError({
				repositoryId: repository.id,
			})

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser: '',
		}
	}

	async authorizeGitRepositoryWrite({
		rawToken,
		slug,
		username,
	}: AuthorizeGitRepositoryWriteInput): Promise<GitRepositoryAuthorization> {
		const { userId } = await this.gitAccessTokensService.verify({
			rawToken,
			requiredPermission: 'git:write',
		})
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		if (repository.ownerUserId !== userId)
			throw new RepositoryGitWriteForbiddenError({
				repositoryId: repository.id,
				userId,
			})

		this.assertTesseraWritesAllowed(repository)

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser: userId,
		}
	}

	async authorizeSshGitRepositoryRead({
		fingerprint,
		slug,
		username,
	}: AuthorizeSshGitRepositoryInput): Promise<GitRepositoryAuthorization> {
		const keyOwnerUserId =
			await this.sshPublicKeysService.findOwnerByFingerprint(fingerprint)
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		if (
			repository.visibility === 'private' &&
			repository.ownerUserId !== keyOwnerUserId
		)
			throw new PrivateRepositoryGitReadForbiddenError({
				repositoryId: repository.id,
				userId: keyOwnerUserId,
			})

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser: keyOwnerUserId,
		}
	}

	async authenticateSshKey({
		fingerprint,
	}: AuthenticateSshKeyInput): Promise<{ trustedUser: UserId }> {
		const keyOwnerUserId =
			await this.sshPublicKeysService.authenticateByFingerprint(fingerprint)

		return { trustedUser: keyOwnerUserId }
	}

	async authorizeSshGitRepositoryWrite({
		fingerprint,
		slug,
		username,
	}: AuthorizeSshGitRepositoryInput): Promise<GitRepositoryAuthorization> {
		const keyOwnerUserId =
			await this.sshPublicKeysService.findOwnerByFingerprint(fingerprint)
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		if (repository.ownerUserId !== keyOwnerUserId)
			throw new RepositoryGitWriteForbiddenError({
				repositoryId: repository.id,
				userId: keyOwnerUserId,
			})

		this.assertTesseraWritesAllowed(repository)

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser: keyOwnerUserId,
		}
	}

	private async createRepositoryMetadata({
		description,
		name,
		slug,
		userId,
		username,
		visibility,
	}: CreateRepositoryMetadataParams): Promise<RepositoryWithOwnerEntity> {
		try {
			return await this.repositoriesRepository.create({
				userId,
				name,
				slug,
				username,
				description,
				visibility,
			})
		} catch (error) {
			if (isUniqueViolation(error, REPOSITORY_SLUG_UNIQUE_CONSTRAINTS))
				throw new DuplicateRepositorySlugError(slug)

			this.logger.error(
				'Failed to create repository',
				error instanceof Error ? error.stack : undefined
			)

			throw error
		}
	}

	private async cleanupCreatedRepository(repositoryId: RepositoryId) {
		try {
			await this.repositoriesRepository.delete({ repositoryId })
		} catch (cleanupError) {
			this.logger.error(
				'Failed to cleanup repository metadata after git storage failure',
				cleanupError instanceof Error ? cleanupError.stack : undefined
			)
		}
	}

	private assertTesseraWritesAllowed(repository: RepositoryWithOwnerEntity) {
		if (repository.externalSource?.mirrorMode !== 'github_to_tessera') return

		throw new RepositoryGitHubSourceOfTruthWriteForbiddenError({
			repositoryId: repository.id,
			provider: repository.externalSource.provider,
			mirrorMode: repository.externalSource.mirrorMode,
		})
	}

	private assertGitHubPushBackAvailable(repository: RepositoryWithOwnerEntity) {
		if (
			repository.externalSource?.provider === 'github' &&
			repository.externalSource.mirrorMode === 'tessera_source'
		)
			return

		throw new RepositoryGitHubPushBackUnavailableError({
			repositoryId: repository.id,
			provider: repository.externalSource?.provider,
			mirrorMode: repository.externalSource?.mirrorMode,
		})
	}

	private assertGitHubPushBackNotRunning(
		repository: RepositoryWithOwnerEntity
	) {
		if (repository.externalSource?.githubPushBackStatus !== 'running') return

		throw new RepositoryGitHubPushBackInProgressError({
			repositoryId: repository.id,
		})
	}

	private async markGitHubPushBackFailed(
		repositoryId: RepositoryId,
		error: unknown
	): Promise<void> {
		const failureReason =
			error instanceof Error ? error.message : 'GitHub push-back mirror failed'

		try {
			await this.repositoriesRepository.markGitHubPushBackFailed({
				repositoryId,
				failedAt: new Date(),
				failureReason,
			})
		} catch (markError) {
			this.logger.error(
				'Failed to mark GitHub push-back mirror as failed',
				markError instanceof Error ? markError.stack : undefined
			)
		}
	}

	private async getRepositoryTreeFromStorage(
		params: GitStorageGetRepositoryTreeParams,
		context: RepositoryBrowserStorageErrorContext
	): Promise<GitStorageRepositoryTree> {
		try {
			return await this.gitStorageClient.getRepositoryTree(params)
		} catch (error) {
			throw toRepositoryBrowserReadError(error, context)
		}
	}

	private async getRepositoryBlobFromStorage(
		params: GitStorageGetRepositoryBlobParams,
		context: RepositoryBrowserStorageErrorContext
	): Promise<GitStorageRepositoryBlob> {
		try {
			return await this.gitStorageClient.getRepositoryBlob(params)
		} catch (error) {
			throw toRepositoryBrowserReadError(error, context)
		}
	}

	private async getRepositoryRawBlobFromStorage(
		params: GitStorageGetRepositoryRawBlobParams,
		context: RepositoryBrowserStorageErrorContext
	): Promise<GitStorageRepositoryRawBlob> {
		try {
			return await this.gitStorageClient.getRepositoryRawBlob(params)
		} catch (error) {
			throw toRepositoryBrowserReadError(error, context)
		}
	}

	private async getRepositoryCommitsFromStorage(
		params: GitStorageListRepositoryCommitsParams,
		context: RepositoryBrowserStorageErrorContext
	): Promise<GitStorageRepositoryCommitHistory> {
		try {
			return await this.gitStorageClient.listRepositoryCommits(params)
		} catch (error) {
			throw toRepositoryBrowserReadError(error, context)
		}
	}

	private async getRepositoryRefsFromStorage(
		params: GitStorageListRepositoryRefsParams,
		context: RepositoryBrowserStorageErrorContext
	): Promise<GitStorageRepositoryRefs> {
		try {
			return await this.gitStorageClient.listRepositoryRefs(params)
		} catch (error) {
			throw toRepositoryBrowserReadError(error, context)
		}
	}

	private resolveSelectedRef({
		defaultBranch,
		ref,
		refs,
		slug,
		username,
	}: {
		defaultBranch: string
		ref: string | undefined
		refs: GitStorageRepositoryRefs
		slug: RepositorySlug
		username: string
	}): GitStorageRepositoryRef | undefined {
		const selectedName = ref ?? defaultBranch
		const searchableRefs = ref
			? [...refs.branches, ...refs.tags]
			: refs.branches
		const selectedRef = searchableRefs.find(repositoryRef =>
			isSelectedRepositoryRef(repositoryRef, selectedName)
		)

		if (selectedRef) return selectedRef
		if (!ref) return undefined

		throw new RepositoryBrowserInvalidRequestError({
			username,
			slug,
			ref,
			path: '',
		})
	}

	private async enrichBlobPreview(
		path: string,
		preview: RepositoryBlobPreview
	): Promise<RepositoryBlobPreview> {
		if (preview.type !== 'text') return preview

		const highlighted = await highlightRepositoryBlobPreview({
			content: preview.content,
			path,
		})

		if (!highlighted) return preview

		return {
			...preview,
			...highlighted,
		}
	}

	private async findReadableRepository(
		viewerUserId: UserId | undefined,
		{ slug, username }: ParsedGetRepositoryInput
	): Promise<ReadableRepositoryContext> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		if (
			repository.visibility === 'private' &&
			repository.ownerUserId !== viewerUserId
		)
			throw new RepositoryNotFoundError({ slug, username })

		if (!repository.storagePath)
			throw new RepositoryStoragePathMissingError({
				repositoryId: repository.id,
			})

		return {
			repository,
			storagePath: repository.storagePath,
		}
	}

	private async listRepositoryOwnerTrustedGpgKeys(
		ownerUserId: UserId | null
	): Promise<GitStorageTrustedGpgKey[]> {
		if (!ownerUserId) return []

		const gpgPublicKeys = await this.gpgPublicKeysService.list(ownerUserId)

		return gpgPublicKeys.map(({ fingerprint, keyId, publicKey }) => ({
			keyId,
			fingerprint,
			publicKey,
		}))
	}
}

function getParentPath(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/')

	if (lastSeparatorIndex === -1) return ''

	return path.slice(0, lastSeparatorIndex)
}

function isSelectedRepositoryRef(
	repositoryRef: GitStorageRepositoryRef,
	selectedName: string
) {
	if (repositoryRef.name === selectedName) return true
	return repositoryRef.qualifiedName === selectedName
}
