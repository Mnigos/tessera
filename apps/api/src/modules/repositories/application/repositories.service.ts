import {
	GitStorageClient,
	type GitStorageGetRepositoryBlobParams,
	type GitStorageGetRepositoryRawBlobParams,
	type GitStorageGetRepositoryTreeParams,
	type GitStorageListRepositoryCommitsParams,
	type GitStorageRepositoryBlob,
	type GitStorageRepositoryCommitHistory,
	type GitStorageRepositoryRawBlob,
	type GitStorageRepositoryTree,
} from '@config/git-storage'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { Injectable, Logger } from '@nestjs/common'
import type {
	CreateRepositoryInput,
	GetRepositoryBlobInput,
	GetRepositoryCommitHistoryInput,
	GetRepositoryInput,
	GetRepositoryTreeInput,
	RepositoryBlob,
	RepositoryBlobPreview,
	RepositoryBrowserSummary,
	RepositoryCommitHistory,
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
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
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
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

const REPOSITORY_SLUG_UNIQUE_CONSTRAINTS = new Set([
	'repositories_owner_user_slug_unique',
	'repositories_owner_organization_slug_unique',
])

interface CreateRepositoryMetadataParams {
	description: string | undefined
	name: RepositoryName
	slug: RepositorySlug
	userId: UserId
	username: string
	visibility: CreateRepositoryInput['visibility']
}

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

export interface GitRepositoryAuthorization {
	repositoryId: RepositoryId
	storagePath: string
	trustedUser: string
}

@Injectable()
export class RepositoriesService {
	private readonly logger = new Logger(RepositoriesService.name)

	constructor(
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly gitStorageClient: GitStorageClient,
		private readonly gitAccessTokensService: GitAccessTokensService
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

	async get(
		userId: UserId,
		{ slug, username }: GetRepositoryInput
	): Promise<RepositoryWithOwner> {
		const repository = await this.repositoriesRepository.find({
			userId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		return toRepositoryOutput(repository)
	}

	async getBrowserSummary(
		viewerUserId: UserId | undefined,
		{ slug, username }: GetRepositoryInput
	): Promise<RepositoryBrowserSummary> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)

		const browserSummary =
			await this.gitStorageClient.getRepositoryBrowserSummary({
				repositoryId: repository.id,
				storagePath,
				defaultBranch: repository.defaultBranch,
			})
		const repositoryOutput = toRepositoryOutput(repository)

		return {
			...repositoryOutput,
			...browserSummary,
		}
	}

	async getTree(
		viewerUserId: UserId | undefined,
		{ path, ref, slug, username }: GetRepositoryTreeInput
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
		{ path, ref, slug, username }: GetRepositoryBlobInput
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
		{ path, ref, slug, username }: GetRepositoryBlobInput
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
		{ limit, ref, slug, username }: GetRepositoryCommitHistoryInput
	): Promise<RepositoryCommitHistory> {
		const { repository, storagePath } = await this.findReadableRepository(
			viewerUserId,
			{ slug, username }
		)
		const commitHistory = await this.getRepositoryCommitsFromStorage(
			{
				repositoryId: repository.id,
				storagePath,
				ref,
				limit,
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
		{ slug, username }: GetRepositoryInput
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
}

function getParentPath(path: string) {
	const lastSeparatorIndex = path.lastIndexOf('/')

	if (lastSeparatorIndex === -1) return ''

	return path.slice(0, lastSeparatorIndex)
}
