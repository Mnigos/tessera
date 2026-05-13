import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, eq, repositories, user } from '@repo/db'
import type {
	RepositoryId,
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

interface FindByOwnerUserIdParams extends UserParams {
	slug: RepositorySlug
	username?: never
}

interface FindByOwnerUsernameParams {
	slug: RepositorySlug
	username: string
	userId?: never
}

type FindParams = FindByOwnerUserIdParams | FindByOwnerUsernameParams

interface RepositoryIdParams {
	repositoryId: RepositoryId
}

interface UpdateStoragePathParams extends RepositoryIdParams {
	storagePath: string
	username: string
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

	async find(params: FindParams): Promise<RepositoryWithOwner | undefined> {
		if ('userId' in params && params.userId !== undefined) {
			const row = await this.db.query.repositories.findFirst({
				where: and(
					eq(repositories.ownerUserId, params.userId),
					eq(repositories.slug, params.slug)
				),
				with: {
					ownerUser: { columns: { username: true } },
				},
			})

			return toRepositoryWithOwner(row)
		}

		const [row] = await this.db
			.select({
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
				ownerUsername: user.username,
			})
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerUserId, user.id))
			.where(
				and(
					eq(user.username, params.username),
					eq(repositories.slug, params.slug)
				)
			)
			.limit(1)

		if (!row?.ownerUsername) return undefined

		return {
			id: row.id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			visibility: row.visibility,
			ownerUserId: row.ownerUserId,
			ownerOrganizationId: row.ownerOrganizationId,
			defaultBranch: row.defaultBranch,
			storagePath: row.storagePath,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			ownerUser: { username: row.ownerUsername },
		}
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

	async updateStoragePath({
		repositoryId,
		storagePath,
		username,
	}: UpdateStoragePathParams): Promise<RepositoryWithOwner | undefined> {
		const [repository] = await this.db
			.update(repositories)
			.set({ storagePath })
			.where(eq(repositories.id, repositoryId))
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

		if (!repository) return undefined

		return {
			...repository,
			ownerUser: { username },
		}
	}

	async delete({ repositoryId }: RepositoryIdParams): Promise<void> {
		await this.db.delete(repositories).where(eq(repositories.id, repositoryId))
	}
}
