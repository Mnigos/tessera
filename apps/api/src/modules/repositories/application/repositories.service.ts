import { GitStorageClient } from '@config/git-storage'
import { Injectable, Logger } from '@nestjs/common'
import type {
	CreateRepositoryInput,
	GetRepositoryInput,
	RepositoryWithOwner,
} from '@repo/contracts'
import type { RepositoryId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	type RepositoryWithOwner as RepositoryWithOwnerEntity,
	toRepositoryOutput,
} from '../domain/repository'
import {
	DuplicateRepositorySlugError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryNotFoundError,
} from '../domain/repository.errors'
import {
	normalizeGeneratedRepositorySlug,
	normalizeRepositoryName,
	normalizeRepositorySlug,
} from '../domain/repository.helpers'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

const REPOSITORY_SLUG_UNIQUE_CONSTRAINTS = new Set([
	'repositories_owner_user_slug_unique',
	'repositories_owner_organization_slug_unique',
])

@Injectable()
export class RepositoriesService {
	private readonly logger = new Logger(RepositoriesService.name)

	constructor(
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly gitStorageClient: GitStorageClient
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

		let repository: RepositoryWithOwnerEntity

		try {
			repository = await this.repositoriesRepository.create({
				userId,
				name,
				slug,
				username: currentUsername,
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
		const repository = await this.repositoriesRepository.findOwned({
			userId,
			slug,
		})

		if (!repository) throw new RepositoryNotFoundError({ slug, username })

		return toRepositoryOutput(repository)
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
}
