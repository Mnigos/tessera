import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	account,
	and,
	asc,
	type DrizzleTransaction,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	repositories,
	repositoryExternalSources,
	sql,
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

interface RepositoryIdWithUserParams extends RepositoryIdParams {
	userId: UserId
}

interface MarkGitHubMirrorSyncFailedParams extends RepositoryIdParams {
	failedAt: Date
	failureReason: string
	nextSyncAt?: Date | null
	syncFailureCount?: number
}

interface ClaimDueGitHubMirrorSyncRepositoriesParams {
	limit: number
	now: Date
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

interface MarkGitHubMirrorSyncSucceededParams
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
	lastSyncFailedAt?: Date | null
	syncFailureReason?: string | null
	nextSyncAt?: Date | null
	syncFailureCount?: number
}

export interface GitHubAccountCredentials {
	accessToken: string | null
}

export interface MarkGitHubMirrorSyncPendingResult {
	didMarkPending: boolean
	repository: RepositoryWithOwner
}

export interface GitHubMirrorSyncRepository extends RepositoryWithOwner {
	externalSource: NonNullable<RepositoryWithOwner['externalSource']>
	ownerUserId: UserId
	storagePath: string
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
	nextSyncAt: repositoryExternalSources.nextSyncAt,
	syncFailureCount: repositoryExternalSources.syncFailureCount,
	syncFailureReason: repositoryExternalSources.syncFailureReason,
	createdAt: repositoryExternalSources.createdAt,
	updatedAt: repositoryExternalSources.updatedAt,
}
const GITHUB_MIRROR_SYNC_STALE_RUNNING_MINUTES = 30

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

	async findGitHubAccount({
		userId,
	}: UserParams): Promise<GitHubAccountCredentials | undefined> {
		return await this.db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
			columns: { accessToken: true },
		})
	}

	async findGitHubMirrorSyncRepository({
		repositoryId,
	}: RepositoryIdParams): Promise<GitHubMirrorSyncRepository | undefined> {
		const [row] = await this.db
			.select(REPOSITORY_WITH_OWNER_COLUMNS)
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerUserId, user.id))
			.innerJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(
				and(
					eq(repositories.id, repositoryId),
					eq(repositoryExternalSources.provider, 'github')
				)
			)
			.limit(1)

		return toGitHubMirrorSyncRepository(row)
	}

	async markGitHubMirrorSyncPending({
		repositoryId,
		userId,
	}: RepositoryIdWithUserParams): Promise<
		MarkGitHubMirrorSyncPendingResult | undefined
	> {
		return await this.db.transaction(async transaction => {
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					mirrorMode: 'github_to_tessera',
					syncStatus: 'pending',
					lastSyncStartedAt: null,
					lastSyncFailedAt: null,
					nextSyncAt: null,
					syncFailureCount: 0,
					syncFailureReason: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						sql`exists (
								select 1
								from ${repositories}
								where ${repositories.id} = ${repositoryExternalSources.repositoryId}
									and ${repositories.ownerUserId} = ${userId}
							)`,
						sql`(
								${repositoryExternalSources.syncStatus} not in (${'pending'}, ${'running'})
								or (
									${repositoryExternalSources.syncStatus} = ${'pending'}
									and ${repositoryExternalSources.updatedAt} < now() - (${GITHUB_MIRROR_SYNC_STALE_RUNNING_MINUTES} * interval '1 minute')
								)
								or (
									${repositoryExternalSources.syncStatus} = ${'running'}
									and (
										${repositoryExternalSources.lastSyncStartedAt} is null
										or ${repositoryExternalSources.lastSyncStartedAt} < now() - (${GITHUB_MIRROR_SYNC_STALE_RUNNING_MINUTES} * interval '1 minute')
									)
								)
							)`
					)
				)
				.returning({ id: repositoryExternalSources.id })
			const repository = await this.findWithClient(transaction, {
				userId,
				repositoryId,
			})

			if (!repository) return undefined

			return {
				didMarkPending: Boolean(updatedExternalSource),
				repository,
			}
		})
	}

	async markGitHubMirrorSyncRunning({
		repositoryId,
	}: RepositoryIdParams): Promise<GitHubMirrorSyncRepository | undefined> {
		const [updatedExternalSource] = await this.db
			.update(repositoryExternalSources)
			.set({
				syncStatus: 'running',
				lastSyncStartedAt: new Date(),
				lastSyncFailedAt: null,
				syncFailureReason: null,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github'),
					inArray(repositoryExternalSources.syncStatus, ['pending', 'running'])
				)
			)
			.returning({ id: repositoryExternalSources.id })

		if (!updatedExternalSource) return undefined

		return await this.findGitHubMirrorSyncRepository({ repositoryId })
	}

	async claimDueGitHubMirrorSyncRepositories({
		limit,
		now,
	}: ClaimDueGitHubMirrorSyncRepositoriesParams): Promise<
		GitHubMirrorSyncRepository[]
	> {
		return await this.db.transaction(async transaction => {
			const staleBefore = new Date(
				now.getTime() - GITHUB_MIRROR_SYNC_STALE_RUNNING_MINUTES * 60_000
			)
			const dueSources = transaction.$with('due_sources').as(
				transaction
					.select({ id: repositoryExternalSources.id })
					.from(repositoryExternalSources)
					.innerJoin(
						repositories,
						eq(repositories.id, repositoryExternalSources.repositoryId)
					)
					.innerJoin(user, eq(user.id, repositories.ownerUserId))
					.where(
						and(
							eq(repositoryExternalSources.provider, 'github'),
							eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
							lte(repositoryExternalSources.nextSyncAt, now),
							isNotNull(repositories.storagePath),
							isNotNull(repositories.ownerUserId),
							or(
								inArray(repositoryExternalSources.syncStatus, [
									'succeeded',
									'failed',
								]),
								and(
									eq(repositoryExternalSources.syncStatus, 'pending'),
									lt(repositoryExternalSources.updatedAt, staleBefore)
								),
								and(
									eq(repositoryExternalSources.syncStatus, 'running'),
									or(
										isNull(repositoryExternalSources.lastSyncStartedAt),
										lt(repositoryExternalSources.lastSyncStartedAt, staleBefore)
									)
								)
							)
						)
					)
					.orderBy(asc(repositoryExternalSources.nextSyncAt))
					.limit(limit)
					.for('update', {
						of: repositoryExternalSources,
						skipLocked: true,
					})
			)
			const claimedSources = await transaction
				.with(dueSources)
				.update(repositoryExternalSources)
				.set({
					syncStatus: 'pending',
					lastSyncFailedAt: null,
					syncFailureReason: null,
					updatedAt: now,
				})
				.from(dueSources)
				.where(eq(repositoryExternalSources.id, dueSources.id))
				.returning({ repositoryId: repositoryExternalSources.repositoryId })
			const claimedRepositoryIds = claimedSources.map(
				({ repositoryId }) => repositoryId
			)

			if (claimedRepositoryIds.length === 0) return []

			const rows = await transaction
				.select(REPOSITORY_WITH_OWNER_COLUMNS)
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerUserId, user.id))
				.innerJoin(
					repositoryExternalSources,
					eq(repositoryExternalSources.repositoryId, repositories.id)
				)
				.where(inArray(repositories.id, claimedRepositoryIds))
				.orderBy(asc(repositoryExternalSources.nextSyncAt))

			return rows.flatMap(row => toGitHubMirrorSyncRepository(row) ?? [])
		})
	}

	async markGitHubMirrorSyncSucceeded({
		defaultBranch,
		repositoryId,
		storagePath,
		username,
		...externalSourceParams
	}: MarkGitHubMirrorSyncSucceededParams): Promise<
		RepositoryWithOwner | undefined
	> {
		return await this.db.transaction(async transaction => {
			const repository = await this.updateImportStorageWithClient(transaction, {
				repositoryId,
				storagePath,
				defaultBranch,
				username,
			})

			if (!repository) return undefined

			await this.upsertGitHubExternalSourceWithClient(transaction, {
				repositoryId,
				...externalSourceParams,
			})

			return repository
		})
	}

	async markGitHubMirrorSyncFailed({
		failedAt,
		failureReason,
		nextSyncAt,
		repositoryId,
		syncFailureCount,
	}: MarkGitHubMirrorSyncFailedParams): Promise<void> {
		await this.db
			.update(repositoryExternalSources)
			.set({
				syncStatus: 'failed',
				lastSyncFailedAt: failedAt,
				nextSyncAt,
				syncFailureCount,
				syncFailureReason: failureReason,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github')
				)
			)
	}

	async upsertGitHubExternalSource({
		externalRepositoryId,
		fullName,
		lastSyncFailedAt,
		lastSyncStartedAt,
		lastSyncSucceededAt,
		mirrorMode,
		name,
		nextSyncAt,
		ownerLogin,
		repositoryId,
		sourceDefaultBranch,
		sourceUrl,
		syncFailureCount,
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
			nextSyncAt,
			syncFailureCount,
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

	private async findWithClient(
		database: RepositoryDatabase,
		{ repositoryId, userId }: RepositoryIdWithUserParams
	): Promise<RepositoryWithOwner | undefined> {
		const [row] = await database
			.select(REPOSITORY_WITH_OWNER_COLUMNS)
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerUserId, user.id))
			.leftJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(
				and(
					eq(repositories.id, repositoryId),
					eq(repositories.ownerUserId, userId)
				)
			)
			.limit(1)

		return toRepositoryWithOwner(toRepositoryRow(row))
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
			nextSyncAt,
			ownerLogin,
			repositoryId,
			sourceDefaultBranch,
			sourceUrl,
			syncFailureCount,
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
				nextSyncAt,
				syncFailureCount,
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
					nextSyncAt,
					syncFailureCount,
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

function toGitHubMirrorSyncRepository(
	row: SelectedRepositoryRow | undefined
): GitHubMirrorSyncRepository | undefined {
	const repository = toRepositoryWithOwner(toRepositoryRow(row))

	if (
		!(
			repository?.ownerUserId &&
			repository.storagePath &&
			repository.externalSource
		)
	)
		return undefined
	const ownerUserId = repository.ownerUserId

	return {
		...repository,
		ownerUserId,
		storagePath: repository.storagePath,
		externalSource: repository.externalSource,
	}
}
