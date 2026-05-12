import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, repositories } from '@repo/db'
import type {
	RepositoryName,
	RepositorySlug,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import {
	type RepositoryWithOwner,
	toRepositoryWithOwner,
} from '../domain/repository'
import { RepositoryCreateFailedError } from '../domain/repository.errors'

interface UserParams {
	userId: UserId
}

interface CreateParams extends UserParams {
	name: RepositoryName
	slug: RepositorySlug
	username: string
	description?: string
	visibility?: RepositoryVisibility
}

interface OwnedRepositoryParams extends UserParams {
	slug: RepositorySlug
}

@Injectable()
export class RepositoriesRepository {
	constructor(private readonly db: Database) {}

	async list({ userId }: UserParams): Promise<RepositoryWithOwner[]> {
		const rows = await this.db.query.repositories.findMany({
			where: eq(repositories.ownerUserId, userId),
			with: {
				ownerUser: { columns: { username: true } },
			},
			orderBy: [asc(repositories.createdAt)],
		})

		return rows.flatMap(row => toRepositoryWithOwner(row) ?? [])
	}

	async findOwned({
		slug,
		userId,
	}: OwnedRepositoryParams): Promise<RepositoryWithOwner | undefined> {
		const row = await this.db.query.repositories.findFirst({
			where: and(
				eq(repositories.ownerUserId, userId),
				eq(repositories.slug, slug)
			),
			with: {
				ownerUser: { columns: { username: true } },
			},
		})

		return toRepositoryWithOwner(row)
	}

	async create({
		description,
		name,
		slug,
		userId,
		username,
		visibility,
	}: CreateParams): Promise<RepositoryWithOwner> {
		const [repository] = await this.db
			.insert(repositories)
			.values({
				ownerUserId: userId,
				name,
				slug,
				description,
				visibility,
			})
			.returning({
				id: repositories.id,
				name: repositories.name,
				slug: repositories.slug,
				description: repositories.description,
				visibility: repositories.visibility,
				ownerUserId: repositories.ownerUserId,
				ownerOrganizationId: repositories.ownerOrganizationId,
				defaultBranch: repositories.defaultBranch,
				storagePath: repositories.storagePath,
				createdAt: repositories.createdAt,
				updatedAt: repositories.updatedAt,
			})

		if (!repository) throw new RepositoryCreateFailedError()

		return {
			...repository,
			ownerUser: { username },
		}
	}
}
