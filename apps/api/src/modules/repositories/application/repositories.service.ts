import { Injectable, Logger } from '@nestjs/common'
import type {
	CreateRepositoryInput,
	GetRepositoryInput,
	RepositoryWithOwner,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { toRepositoryOutput } from '../domain/repository'
import {
	DuplicateRepositorySlugError,
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
		private readonly repositoriesRepository: RepositoriesRepository
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

		try {
			return toRepositoryOutput(
				await this.repositoriesRepository.create({
					userId,
					name,
					slug,
					username: currentUsername,
					description,
					visibility,
				})
			)
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
}
