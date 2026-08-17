import { EnvService } from '@config/env'
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
import { ChecksReadService } from '@modules/checks'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { GpgPublicKeysService } from '@modules/gpg-public-keys'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import { Injectable, Logger } from '@nestjs/common'
import type {
	CreateRepositoryInput,
	ParsedCutoverGitHubMirrorInput,
	ParsedEnableGitHubMirrorInput,
	ParsedGetGitHubReauthorizationInput,
	ParsedGetGitHubSyncHealthInput,
	ParsedGetRepositoryBlobInput,
	ParsedGetRepositoryBrowserSummaryInput,
	ParsedGetRepositoryCommitHistoryInput,
	ParsedGetRepositoryInput,
	ParsedGetRepositoryRefsInput,
	ParsedGetRepositoryTreeInput,
	RepositoryBlob,
	RepositoryBlobPreview,
	RepositoryBrowserSummary,
	RepositoryCommitHistory,
	RepositoryRefs,
	RepositorySyncHealth,
	RepositoryTree,
	RepositoryWithOwner,
} from '@repo/contracts'
import {
	canAdministerRepository,
	canReadRepository,
	canWriteRepository,
	type OrganizationId,
	type RepositoryId,
	type RepositoryName,
	type RepositoryRole,
	type RepositorySlug,
	type RepositoryVisibility,
	type UserId,
} from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	type RepositoryWithOwner as RepositoryWithOwnerEntity,
	toRepositoryOutput,
} from '../domain/repository'
import {
	allowsTesseraWrites,
	assertRepositoryHasStoragePath,
	assertTesseraWritesAllowed,
} from '../domain/repository.assertions'
import {
	DuplicateRepositorySlugError,
	RepositoryAdminForbiddenError,
	RepositoryBrowserInvalidRequestError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryGitHubMirrorCutoverSyncInProgressError,
	RepositoryGitHubMirrorCutoverUnavailableError,
	RepositoryGitHubMirrorSyncUnavailableError,
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
} from '../domain/repository.errors'
import {
	normalizeGeneratedRepositorySlug,
	normalizeRepositoryName,
	normalizeRepositorySlug,
} from '../domain/repository.helpers'
import type { RepositoryCloneBaseUrls } from '../domain/repository-clone-urls'
import { toRepositorySyncHealth } from '../domain/repository-sync-health'
import { highlightRepositoryBlobPreview } from '../helpers/repository-blob-highlighting'
import {
	type RepositoryBrowserStorageErrorContext,
	toRepositoryBrowserReadError,
} from '../helpers/repository-browser-storage-error'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import { RepositorySyncHealthRepository } from '../infrastructure/repository-sync-health.repository'
import { RepositoryPermissionsService } from './repository-permissions.service'

const REPOSITORY_SLUG_UNIQUE_CONSTRAINTS = new Set([
	'repositories_owner_user_slug_unique',
	'repositories_owner_organization_slug_unique',
])

const REPOSITORY_PRINCIPAL_LIMIT = 50

export interface RepositoryPrincipal {
	userId: UserId
	username: string
}

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

export interface GitHubWriteThroughTarget {
	name: string
	ownerLogin: string
}

export interface RepositoryAccessContext {
	repositoryId: RepositoryId
	storagePath: string
	viewerRole: RepositoryRole
	tesseraWritesAllowed: boolean
	/** Present only while GitHub owns the write side, which is what routes writes there. */
	gitHubTarget?: GitHubWriteThroughTarget
}

/**
 * A repository resolved by identity for work nobody is watching. The role is
 * optional because the user a queued merge belongs to may have lost access
 * since, which the merge evaluation reports rather than throws.
 */
export interface RepositoryMergeContext {
	repositoryId: RepositoryId
	storagePath: string
	tesseraWritesAllowed: boolean
	viewerRole?: RepositoryRole
}

export interface RepositoryManagementContext {
	repositoryId: RepositoryId
	visibility: RepositoryVisibility
	ownerUserId: UserId | null
	ownerOrganizationId: OrganizationId | null
	/**
	 * Whether Tessera owns the write side. Settings surfaces stay editable on a
	 * GitHub-authoritative repository, so they report this rather than reject.
	 */
	tesseraWritesAllowed: boolean
}

/** A repository named by a path, and whether Tessera owns writes to it. */
export interface RepositoryTarget {
	repositoryId: RepositoryId
	tesseraWritesAllowed: boolean
}

export interface AuthorizeGitRepositoryReadInput {
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

export interface AuthenticateSshKeyResult {
	trustedUser: UserId
}

export interface GitRepositoryAuthorization {
	repositoryId: RepositoryId
	storagePath: string
	trustedUser: string
}

interface ReadableRepositoryContext {
	repository: RepositoryWithOwnerEntity
	storagePath: string
	role: RepositoryRole
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
		private readonly gpgPublicKeysService: GpgPublicKeysService,
		private readonly sshPublicKeysService: SshPublicKeysService,
		private readonly envService: EnvService,
		private readonly repositoryPermissionsService: RepositoryPermissionsService,
		private readonly gitAccessTokensService: GitAccessTokensService,
		private readonly checksReadService: ChecksReadService,
		private readonly repositorySyncHealthRepository: RepositorySyncHealthRepository
	) {}

	private get cloneBaseUrls(): RepositoryCloneBaseUrls {
		return {
			http: this.envService.get('GIT_HTTP_BASE_URL'),
			ssh: this.envService.get('GIT_SSH_BASE_URL'),
		}
	}

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

			return toRepositoryOutput(repositoryWithStorage, this.cloneBaseUrls)
		} catch (error) {
			await this.cleanupCreatedRepository(repository.id)

			throw error
		}
	}

	async list(userId: UserId): Promise<RepositoryWithOwner[]> {
		const repositories = await this.repositoriesRepository.list({ userId })
		// Read once for the page rather than once per row.
		const cloneBaseUrls = this.cloneBaseUrls

		return repositories.map(repository =>
			toRepositoryOutput(repository, cloneBaseUrls)
		)
	}

	async getReadableRepositoryContext(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<RepositoryAccessContext> {
		const { repository, role, storagePath } = await this.findReadableRepository(
			viewerUserId,
			input
		)

		return toRepositoryAccessContext({ ...repository, storagePath }, role)
	}

	async getWritableRepositoryContext(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<RepositoryAccessContext> {
		const { context, repository } = await this.resolveWritableRepository(
			viewerUserId,
			input
		)

		assertTesseraWritesAllowed(repository)

		return context
	}

	async getPullRequestWriteContext(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<RepositoryAccessContext> {
		return (await this.resolveWritableRepository(viewerUserId, input)).context
	}

	private async resolveWritableRepository(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<{
		context: RepositoryAccessContext
		repository: RepositoryWithOwnerEntity & { storagePath: string }
	}> {
		const { repository, role } = await this.resolveReadableRepositoryRole(
			viewerUserId,
			input
		)

		if (!canWriteRepository(role))
			throw new RepositoryGitWriteForbiddenError({
				username: input.username,
				slug: input.slug,
				userId: viewerUserId,
			})

		assertRepositoryHasStoragePath(repository)

		return { context: toRepositoryAccessContext(repository, role), repository }
	}

	/**
	 * What a background merge needs to know about a repository it was handed the
	 * identity of: where it lives, whether Tessera owns its write side, and what
	 * the user whose merge is being run may still do there.
	 *
	 * Nothing is asserted. A user who lost write access, or a repository that
	 * became a GitHub mirror while its pull request waited in the queue, is a
	 * reason to refuse the merge rather than an error, and the merge requirements
	 * are what say so.
	 */
	async findRepositoryMergeContext({
		repositoryId,
		userId,
	}: {
		repositoryId: RepositoryId
		userId: UserId
	}): Promise<RepositoryMergeContext | undefined> {
		const repository = await this.repositoriesRepository.findById({
			repositoryId,
		})

		if (!repository?.storagePath) return undefined

		const role = await this.repositoryPermissionsService.resolveRole(
			userId,
			repository
		)

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			tesseraWritesAllowed: allowsTesseraWrites(repository),
			viewerRole: role ?? undefined,
		}
	}

	/**
	 * Whether the given user may read the repository. Callers outside this module
	 * use it to validate participants without touching collaborator tables.
	 */
	async canUserReadRepository(
		userId: UserId,
		input: ParsedGetRepositoryInput
	): Promise<boolean> {
		const repository = await this.findRepository(input)
		const role = await this.repositoryPermissionsService.resolveRole(
			userId,
			repository
		)

		return canReadRepository(role)
	}

	/**
	 * Bounded list of users with explicitly granted repository access. Public
	 * repositories are readable by everyone, so this is a suggestion list rather
	 * than the full set of eligible participants.
	 */
	async listRepositoryPrincipals(
		repositoryId: RepositoryId
	): Promise<RepositoryPrincipal[]> {
		const principals = await this.repositoriesRepository.listPrivilegedUsers({
			repositoryId,
			limit: REPOSITORY_PRINCIPAL_LIMIT,
		})

		return principals.flatMap(({ userId, username }) =>
			username ? [{ userId, username }] : []
		)
	}

	async assertViewerRepositoryWriteAccess(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<void> {
		const { role } = await this.resolveReadableRepositoryRole(
			viewerUserId,
			input
		)

		if (!canWriteRepository(role))
			throw new RepositoryGitWriteForbiddenError({
				username: input.username,
				slug: input.slug,
				userId: viewerUserId,
			})
	}

	async assertViewerRepositoryAdminAccess(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<void> {
		const { role } = await this.resolveReadableRepositoryRole(
			viewerUserId,
			input
		)

		if (!canAdministerRepository(role))
			throw new RepositoryAdminForbiddenError({
				username: input.username,
				slug: input.slug,
				userId: viewerUserId,
			})
	}

	async getManageableRepositoryContext(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<RepositoryManagementContext> {
		const { repository, role } = await this.resolveReadableRepositoryRole(
			viewerUserId,
			input
		)

		if (!canAdministerRepository(role))
			throw new RepositoryAdminForbiddenError({
				username: input.username,
				slug: input.slug,
				userId: viewerUserId,
			})

		return {
			repositoryId: repository.id,
			visibility: repository.visibility,
			ownerUserId: repository.ownerUserId,
			ownerOrganizationId: repository.ownerOrganizationId,
			tesseraWritesAllowed: allowsTesseraWrites(repository),
		}
	}

	/**
	 * The repository at a path, with no viewer and no access decision.
	 *
	 * For callers whose authorization was already settled elsewhere and who need
	 * the path resolved solely to confirm it names the repository they were
	 * admitted to — an external status publisher holding a repository-confined
	 * credential is the case. It reports whether Tessera owns the write side too,
	 * because a caller that may write to this repository still may not write to a
	 * repository GitHub is authoritative for.
	 *
	 * Absent rather than raising, so such a caller can answer an unknown path and
	 * an unauthorized one identically instead of turning this into a way to
	 * discover which repositories exist.
	 */
	async findRepositoryTargetByPath({
		slug,
		username,
	}: ParsedGetRepositoryInput): Promise<RepositoryTarget | undefined> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) return undefined

		return {
			repositoryId: repository.id,
			tesseraWritesAllowed: allowsTesseraWrites(repository),
		}
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

		return toRepositoryOutput(repository, this.cloneBaseUrls)
	}

	async enableGitHubMirror(
		targetUserId: UserId,
		{ slug, username }: ParsedEnableGitHubMirrorInput
	) {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })
		if (
			repository.externalSource?.provider !== 'github' ||
			repository.externalSource.mirrorMode !== 'imported'
		)
			throw new RepositoryGitHubMirrorSyncUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource?.provider,
				mirrorMode: repository.externalSource?.mirrorMode,
			})

		const enablement =
			await this.repositoriesRepository.findGitHubMirrorEnablement({
				repositoryId: repository.id,
			})

		if (!enablement?.installationId) {
			const installUrl = this.envService.get('GITHUB_APP_INSTALL_URL')
			if (!installUrl)
				throw new RepositoryGitHubMirrorSyncUnavailableError({
					repositoryId: repository.id,
					reason: 'missing_github_app_install_url',
				})

			return { status: 'installation_required' as const, installUrl }
		}

		const didEnable = await this.repositoriesRepository.enableGitHubMirror({
			repositoryId: repository.id,
			userId: targetUserId,
		})

		if (!didEnable)
			throw new RepositoryGitHubMirrorSyncUnavailableError({
				repositoryId: repository.id,
			})

		return { status: 'enabled' as const }
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

		// A run that finalized is not the same as a mirror that converged: a
		// contained stage failure or a delivery no run has consumed still records
		// `succeeded`. Switching authority on that would hand Tessera a repository
		// missing whatever GitHub never got to answer for, permanently.
		const syncHealth = await this.findGitHubSyncHealth(repository.id)

		if (syncHealth?.state !== 'healthy')
			throw new RepositoryGitHubMirrorCutoverUnavailableError({
				repositoryId: repository.id,
				provider: repository.externalSource.provider,
				mirrorMode: repository.externalSource.mirrorMode,
				syncHealthState: syncHealth?.state,
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

		return toRepositoryOutput(cutoverRepository, this.cloneBaseUrls)
	}

	async getGitHubSyncHealth(
		targetUserId: UserId,
		{ slug, username }: ParsedGetGitHubSyncHealthInput
	): Promise<{ syncHealth?: RepositorySyncHealth }> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		return { syncHealth: await this.findGitHubSyncHealth(repository.id) }
	}

	/**
	 * What a person can do about a blocked mirror, and nothing else.
	 *
	 * Resuming is GitHub's to announce: the installation webhook that follows a
	 * reauthorization is what rebinds the installation and requests a new sync.
	 * This procedure only points at the page where that grant is made, so asking
	 * for it never starts a synchronization.
	 */
	async getGitHubReauthorization(
		targetUserId: UserId,
		{ slug, username }: ParsedGetGitHubReauthorizationInput
	): Promise<{ reauthorizationRequired: boolean; installUrl?: string }> {
		const repository = await this.repositoriesRepository.find({
			userId: targetUserId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		const syncHealth = await this.findGitHubSyncHealth(repository.id)

		if (!syncHealth?.reauthorizationRequired)
			return { reauthorizationRequired: false }

		const installUrl = this.envService.get('GITHUB_APP_INSTALL_URL')

		// Telling someone their mirror needs reauthorizing without saying where to
		// do it leaves them stuck. A deployment that mirrors from GitHub but has no
		// install URL configured is misconfigured, which is the same conclusion the
		// enablement path reaches, so it fails the same way rather than answering
		// with guidance nobody can act on.
		if (!installUrl)
			throw new RepositoryGitHubMirrorSyncUnavailableError({
				repositoryId: repository.id,
				reason: 'missing_github_app_install_url',
			})

		return { reauthorizationRequired: true, installUrl }
	}

	private async findGitHubSyncHealth(
		repositoryId: RepositoryId
	): Promise<RepositorySyncHealth | undefined> {
		const now = new Date()
		const facts = await this.repositorySyncHealthRepository.findFacts({
			now,
			repositoryId,
		})

		if (!facts) return undefined

		return toRepositorySyncHealth(facts, {
			now,
			syncIntervalMinutes: this.envService.get(
				'GITHUB_MIRROR_SYNC_INTERVAL_MINUTES'
			),
		})
	}

	async getBrowserSummary(
		viewerUserId: UserId | undefined,
		{ ref, slug, username }: ParsedGetRepositoryBrowserSummaryInput
	): Promise<RepositoryBrowserSummary> {
		const { repository, storagePath, role } = await this.findReadableRepository(
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
		const repositoryOutput = toRepositoryOutput(repository, this.cloneBaseUrls)

		return {
			...repositoryOutput,
			...browserSummary,
			viewerRole: role,
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
		const repositoryOutput = toRepositoryOutput(repository, this.cloneBaseUrls)

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
		const repositoryOutput = toRepositoryOutput(repository, this.cloneBaseUrls)

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
		const repositoryOutput = toRepositoryOutput(repository, this.cloneBaseUrls)
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
		const repositoryOutput = toRepositoryOutput(repository, this.cloneBaseUrls)
		// One query for the page rather than one per row: a status dot beside every
		// commit must not cost a request each. Nothing here is current — history is
		// read against a ref, not against any pull request's head — so no row
		// claims to describe the tip of anything.
		const checksSummaries = await this.checksReadService.listSummaries({
			heads: commitHistory.commits.map(commit => ({
				key: commit.sha,
				sha: commit.sha,
				isCurrent: false,
			})),
			repositoryId: repository.id,
		})

		return {
			...repositoryOutput,
			ref,
			commits: commitHistory.commits.map(commit => ({
				...commit,
				checksSummary: checksSummaries.get(commit.sha),
			})),
		}
	}

	async authorizeGitRepositoryRead(
		input: AuthorizeGitRepositoryReadInput,
		rawToken?: string
	): Promise<GitRepositoryAuthorization> {
		if (!rawToken)
			return this.authorizeGitRepositoryReadForViewer(input, null, '')

		const { userId } = await this.gitAccessTokensService.verify({
			rawToken,
			requiredPermission: 'git:read',
		})

		return this.authorizeGitRepositoryReadForViewer(input, userId, userId)
	}

	async authorizeSshGitRepositoryRead({
		fingerprint,
		slug,
		username,
	}: AuthorizeSshGitRepositoryInput): Promise<GitRepositoryAuthorization> {
		const keyOwnerUserId =
			await this.sshPublicKeysService.findOwnerByFingerprint(fingerprint)

		return this.authorizeGitRepositoryReadForViewer(
			{ slug, username },
			keyOwnerUserId,
			keyOwnerUserId
		)
	}

	private async authorizeGitRepositoryReadForViewer(
		{ slug, username }: AuthorizeGitRepositoryReadInput,
		viewerUserId: UserId | null,
		trustedUser: string
	): Promise<GitRepositoryAuthorization> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		const role = await this.repositoryPermissionsService.resolveRole(
			viewerUserId,
			repository
		)

		if (!canReadRepository(role))
			throw new RepositoryNotFoundError({ slug, username })

		assertRepositoryHasStoragePath(repository)

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser,
		}
	}

	async authorizeGitRepositoryWrite(
		{ slug, username }: AuthorizeGitRepositoryReadInput,
		trustedUserId: UserId
	): Promise<GitRepositoryAuthorization> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		const role = await this.repositoryPermissionsService.resolveRole(
			trustedUserId,
			repository
		)

		if (!canWriteRepository(role)) {
			if (canReadRepository(role))
				throw new RepositoryGitWriteForbiddenError({
					repositoryId: repository.id,
					userId: trustedUserId,
				})

			throw new RepositoryNotFoundError({ slug, username })
		}

		assertTesseraWritesAllowed(repository)
		assertRepositoryHasStoragePath(repository)

		return {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			trustedUser: trustedUserId,
		}
	}

	async authenticateSshKey({
		fingerprint,
	}: AuthenticateSshKeyInput): Promise<AuthenticateSshKeyResult> {
		const keyOwnerUserId =
			await this.sshPublicKeysService.authenticateByFingerprint(fingerprint)

		return { trustedUser: keyOwnerUserId }
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
		input: ParsedGetRepositoryInput
	): Promise<ReadableRepositoryContext> {
		const { repository, role } = await this.resolveReadableRepositoryRole(
			viewerUserId,
			input
		)

		assertRepositoryHasStoragePath(repository)

		return {
			repository,
			storagePath: repository.storagePath,
			role,
		}
	}

	private async resolveReadableRepositoryRole(
		viewerUserId: UserId | undefined,
		input: ParsedGetRepositoryInput
	): Promise<{ repository: RepositoryWithOwnerEntity; role: RepositoryRole }> {
		const repository = await this.findRepository(input)
		const role = await this.repositoryPermissionsService.resolveRole(
			viewerUserId ?? null,
			repository
		)

		if (!canReadRepository(role))
			throw new RepositoryNotFoundError({
				slug: input.slug,
				username: input.username,
			})

		return { repository, role }
	}

	private async findRepository({
		slug,
		username,
	}: ParsedGetRepositoryInput): Promise<RepositoryWithOwnerEntity> {
		const repository = await this.repositoriesRepository.find({
			username,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		return repository
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

function toRepositoryAccessContext(
	repository: RepositoryWithOwnerEntity & { storagePath: string },
	role: RepositoryRole
): RepositoryAccessContext {
	const { externalSource } = repository

	return {
		repositoryId: repository.id,
		storagePath: repository.storagePath,
		viewerRole: role,
		tesseraWritesAllowed: allowsTesseraWrites(repository),
		gitHubTarget:
			externalSource?.mirrorMode === 'github_to_tessera'
				? { name: externalSource.name, ownerLogin: externalSource.ownerLogin }
				: undefined,
	}
}
