import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	type DrizzleTransaction,
	eq,
	isNotNull,
	repositories,
	repositoryExternalSources,
	user,
} from '@repo/db'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import {
	type RepositoryOwnerRow,
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

interface UpdateImportStorageParams extends RepositoryIdParams {
	defaultBranch: string
	storagePath: string
	username: string
}

export interface CompleteImportedGitHubRepositoryParams
	extends UpdateImportStorageParams,
		UpsertGitHubExternalSourceParams {}

export interface UpsertGitHubExternalSourceParams extends RepositoryIdParams {
	externalRepositoryId: bigint
	ownerLogin: string
	name: string
	fullName: string
	sourceUrl: string
	sourceDefaultBranch: string
	mirrorMode: 'imported' | 'github_to_tessera'
	syncStatus: 'pending' | 'running' | 'succeeded' | 'failed'
	lastSyncStartedAt?: Date
	lastSyncSucceededAt?: Date
	lastSyncFailedAt?: Date
	syncFailureReason?: string
}

type RepositoryDatabase = Database | DrizzleTransaction

const REPOSITORY_EXTERNAL_SOURCE_COLUMNS = {
	id: repositoryExternalSources.id,
	repositoryId: repositoryExternalSources.repositoryId,
	provider: repositoryExternalSources.provider,
	externalRepositoryId: repositoryExternalSources.externalRepositoryId,
	ownerLogin: repositoryExternalSources.ownerLogin,
	name: repositoryExternalSources.name,
	fullName: repositoryExternalSources.fullName,
	sourceUrl: repositoryExternalSources.sourceUrl,
	sourceDefaultBranch: repositoryExternalSources.sourceDefaultBranch,
	mirrorMode: repositoryExternalSources.mirrorMode,
	syncStatus: repositoryExternalSources.syncStatus,
	lastSyncStartedAt: repositoryExternalSources.lastSyncStartedAt,
	lastSyncSucceededAt: repositoryExternalSources.lastSyncSucceededAt,
	lastSyncFailedAt: repositoryExternalSources.lastSyncFailedAt,
	syncFailureReason: repositoryExternalSources.syncFailureReason,
	createdAt: repositoryExternalSources.createdAt,
	updatedAt: repositoryExternalSources.updatedAt,
}

const REPOSITORY_WITH_OWNER_COLUMNS = {
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
	externalSource: REPOSITORY_EXTERNAL_SOURCE_COLUMNS,
}

@Injectable()
export class RepositoriesRepository {
	constructor(private readonly db: Database) {}

	async list({ userId }: UserParams): Promise<RepositoryWithOwner[]> {
		const rows = await this.db
			.select(REPOSITORY_WITH_OWNER_COLUMNS)
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerUserId, user.id))
			.leftJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(
				and(
					eq(repositories.ownerUserId, userId),
					isNotNull(repositories.storagePath)
				)
			)
			.orderBy(asc(repositories.createdAt))

		return rows.flatMap(
			row => toRepositoryWithOwner(toRepositoryRow(row)) ?? []
		)
	}

	async find(params: FindParams): Promise<RepositoryWithOwner | undefined> {
		if ('userId' in params && params.userId !== undefined) {
			const [row] = await this.db
				.select(REPOSITORY_WITH_OWNER_COLUMNS)
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerUserId, user.id))
				.leftJoin(
					repositoryExternalSources,
					eq(repositoryExternalSources.repositoryId, repositories.id)
				)
				.where(
					and(
						eq(repositories.ownerUserId, params.userId),
						eq(repositories.slug, params.slug)
					)
				)
				.limit(1)

			return toRepositoryWithOwner(toRepositoryRow(row))
		}

		const [row] = await this.db
			.select(REPOSITORY_WITH_OWNER_COLUMNS)
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerUserId, user.id))
			.leftJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(
				and(
					eq(user.username, params.username),
					eq(repositories.slug, params.slug)
				)
			)
			.limit(1)

		return toRepositoryWithOwner(toRepositoryRow(row))
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

	async updateImportStorage({
		defaultBranch,
		repositoryId,
		storagePath,
		username,
	}: UpdateImportStorageParams): Promise<RepositoryWithOwner | undefined> {
		return await this.updateImportStorageWithClient(this.db, {
			repositoryId,
			storagePath,
			defaultBranch,
			username,
		})
	}

	async completeImportedGitHubRepository(
		params: CompleteImportedGitHubRepositoryParams
	): Promise<RepositoryWithOwner | undefined> {
		return await this.db.transaction(async transaction => {
			const repository = await this.updateImportStorageWithClient(
				transaction,
				params
			)

			if (!repository) return undefined

			await this.upsertGitHubExternalSourceWithClient(transaction, params)

			return repository
		})
	}

	async delete({ repositoryId }: RepositoryIdParams): Promise<void> {
		await this.db.delete(repositories).where(eq(repositories.id, repositoryId))
	}

	async upsertGitHubExternalSource({
		externalRepositoryId,
		fullName,
		lastSyncFailedAt,
		lastSyncStartedAt,
		lastSyncSucceededAt,
		mirrorMode,
		name,
		ownerLogin,
		repositoryId,
		sourceDefaultBranch,
		sourceUrl,
		syncFailureReason,
		syncStatus,
	}: UpsertGitHubExternalSourceParams): Promise<void> {
		await this.upsertGitHubExternalSourceWithClient(this.db, {
			repositoryId,
			externalRepositoryId,
			ownerLogin,
			name,
			fullName,
			sourceUrl,
			sourceDefaultBranch,
			mirrorMode,
			syncStatus,
			lastSyncStartedAt,
			lastSyncSucceededAt,
			lastSyncFailedAt,
			syncFailureReason,
		})
	}

	private async updateImportStorageWithClient(
		database: RepositoryDatabase,
		{
			defaultBranch,
			repositoryId,
			storagePath,
			username,
		}: UpdateImportStorageParams
	): Promise<RepositoryWithOwner | undefined> {
		const [repository] = await database
			.update(repositories)
			.set({ defaultBranch, storagePath })
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

	private async upsertGitHubExternalSourceWithClient(
		database: RepositoryDatabase,
		{
			externalRepositoryId,
			fullName,
			lastSyncFailedAt,
			lastSyncStartedAt,
			lastSyncSucceededAt,
			mirrorMode,
			name,
			ownerLogin,
			repositoryId,
			sourceDefaultBranch,
			sourceUrl,
			syncFailureReason,
			syncStatus,
		}: UpsertGitHubExternalSourceParams
	): Promise<void> {
		await database
			.insert(repositoryExternalSources)
			.values({
				repositoryId,
				provider: 'github',
				externalRepositoryId,
				ownerLogin,
				name,
				fullName,
				sourceUrl,
				sourceDefaultBranch,
				mirrorMode,
				syncStatus,
				lastSyncStartedAt,
				lastSyncSucceededAt,
				lastSyncFailedAt,
				syncFailureReason,
			})
			.onConflictDoUpdate({
				target: repositoryExternalSources.repositoryId,
				set: {
					externalRepositoryId,
					ownerLogin,
					name,
					fullName,
					sourceUrl,
					sourceDefaultBranch,
					mirrorMode,
					syncStatus,
					lastSyncStartedAt,
					lastSyncSucceededAt,
					lastSyncFailedAt,
					syncFailureReason,
				},
			})
	}
}

interface SelectedRepositoryRow {
	id: RepositoryId
	name: RepositoryName
	slug: RepositorySlug
	description: string | null
	visibility: RepositoryVisibility
	ownerUserId: UserId | null
	ownerOrganizationId: OrganizationId | null
	defaultBranch: string
	storagePath: string | null
	createdAt: Date
	updatedAt: Date
	ownerUsername: string | null
	externalSource: RepositoryOwnerRow['externalSource'] | null
}

function toRepositoryRow(
	row: SelectedRepositoryRow | undefined
): RepositoryOwnerRow | undefined {
	if (!row) return undefined

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
		externalSource: row.externalSource?.id ? row.externalSource : undefined,
	}
}
