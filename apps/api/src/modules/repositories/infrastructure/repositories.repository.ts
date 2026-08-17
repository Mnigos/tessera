import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	account,
	and,
	asc,
	type DrizzleTransaction,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	type Member,
	member,
	ne,
	or,
	organization,
	repositories,
	repositoryCollaborators,
	repositoryExternalSources,
	sql,
	user,
} from '@repo/db'
import type {
	OrganizationId,
	RepositoryCollaboratorRole,
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

export interface GitHubMirrorEnablement {
	installationId?: string
	mirrorMode: 'imported' | 'github_to_tessera' | 'tessera_source'
}

interface CutoverGitHubMirrorParams extends RepositoryIdWithUserParams {
	actorUserId: UserId
	cutoverAt: Date
}

interface MarkGitHubPushBackRunningParams extends RepositoryIdWithUserParams {
	startedAt: Date
}

interface MarkGitHubPushBackFailedParams extends RepositoryIdParams {
	failedAt: Date
	failureReason: string
}

interface MarkGitHubPushBackSucceededParams extends RepositoryIdParams {
	succeededAt: Date
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

interface ListPrivilegedUsersParams extends RepositoryIdParams {
	limit: number
}

export interface PrivilegedUserRow {
	userId: UserId
	username: string | null
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

interface ViewerParams {
	viewerUserId?: UserId
}

interface ListVisibleByUserParams extends ViewerParams {
	ownerUserId: UserId
	ownerOrganizationId?: never
}

interface ListVisibleByOrganizationParams extends ViewerParams {
	ownerOrganizationId: OrganizationId
	ownerUserId?: never
}

export type ListVisibleByOwnerParams =
	| ListVisibleByUserParams
	| ListVisibleByOrganizationParams

export interface OwnedRepositoryListItem {
	id: RepositoryId
	name: RepositoryName
	slug: RepositorySlug
	visibility: RepositoryVisibility
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
	cutoverActorUserId: repositoryExternalSources.cutoverActorUserId,
	cutoverAt: repositoryExternalSources.cutoverAt,
	cutoverFromMirrorMode: repositoryExternalSources.cutoverFromMirrorMode,
	githubPushBackEnabled: repositoryExternalSources.githubPushBackEnabled,
	githubPushBackStatus: repositoryExternalSources.githubPushBackStatus,
	githubPushBackStartedAt: repositoryExternalSources.githubPushBackStartedAt,
	githubPushBackSucceededAt:
		repositoryExternalSources.githubPushBackSucceededAt,
	githubPushBackFailedAt: repositoryExternalSources.githubPushBackFailedAt,
	githubPushBackFailureReason:
		repositoryExternalSources.githubPushBackFailureReason,
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

const REPOSITORY_WITH_OWNER_HANDLE_COLUMNS = {
	...REPOSITORY_WITH_OWNER_COLUMNS,
	ownerUsername: sql<
		string | null
	>`coalesce(${user.username}, ${organization.slug})`,
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
			.select(REPOSITORY_WITH_OWNER_HANDLE_COLUMNS)
			.from(repositories)
			.leftJoin(user, eq(repositories.ownerUserId, user.id))
			.leftJoin(
				organization,
				eq(repositories.ownerOrganizationId, organization.id)
			)
			.leftJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(
				and(
					eq(repositories.slug, params.slug),
					or(
						eq(user.username, params.username),
						eq(organization.slug, params.username)
					)
				)
			)
			.orderBy(
				sql`case when ${user.username} = ${params.username} then 0 else 1 end`
			)
			.limit(1)

		return toRepositoryWithOwner(toRepositoryRow(row))
	}

	/**
	 * The repository as background work knows it: by identity, with no handle to
	 * resolve it through. The owner join stays outer because an organization
	 * repository has no owning user row.
	 */
	async findById({
		repositoryId,
	}: RepositoryIdParams): Promise<RepositoryWithOwner | undefined> {
		const [row] = await this.db
			.select(REPOSITORY_WITH_OWNER_HANDLE_COLUMNS)
			.from(repositories)
			.leftJoin(user, eq(repositories.ownerUserId, user.id))
			.leftJoin(
				organization,
				eq(repositories.ownerOrganizationId, organization.id)
			)
			.leftJoin(
				repositoryExternalSources,
				eq(repositoryExternalSources.repositoryId, repositories.id)
			)
			.where(eq(repositories.id, repositoryId))
			.limit(1)

		return toRepositoryWithOwner(toRepositoryRow(row))
	}

	async findCollaboratorRole({
		repositoryId,
		userId,
	}: RepositoryIdWithUserParams): Promise<
		RepositoryCollaboratorRole | undefined
	> {
		const [row] = await this.db
			.select({ role: repositoryCollaborators.role })
			.from(repositoryCollaborators)
			.where(
				and(
					eq(repositoryCollaborators.repositoryId, repositoryId),
					eq(repositoryCollaborators.userId, userId)
				)
			)
			.limit(1)

		return row?.role
	}

	/**
	 * Users with explicitly granted access: the owner, stored collaborators and
	 * organization owners/admins. Public-repository readers are unbounded and
	 * therefore intentionally absent.
	 */
	async listPrivilegedUsers({
		limit,
		repositoryId,
	}: ListPrivilegedUsersParams): Promise<PrivilegedUserRow[]> {
		return await this.db
			.selectDistinct({ userId: user.id, username: user.username })
			.from(repositories)
			.innerJoin(
				user,
				or(
					eq(user.id, repositories.ownerUserId),
					inArray(
						user.id,
						this.db
							.select({ userId: repositoryCollaborators.userId })
							.from(repositoryCollaborators)
							.where(eq(repositoryCollaborators.repositoryId, repositoryId))
					),
					inArray(
						user.id,
						this.db
							.select({ userId: member.userId })
							.from(member)
							.where(
								and(
									eq(member.organizationId, repositories.ownerOrganizationId),
									inArray(member.role, ['owner', 'admin'])
								)
							)
					)
				)
			)
			.where(eq(repositories.id, repositoryId))
			.orderBy(asc(user.username))
			.limit(limit)
	}

	async findOrganizationMemberRole({
		organizationId,
		userId,
	}: {
		organizationId: OrganizationId
		userId: UserId
	}): Promise<Member['role'] | undefined> {
		const [row] = await this.db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.organizationId, organizationId),
					eq(member.userId, userId)
				)
			)
			.limit(1)

		return row?.role
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

	async findGitHubMirrorEnablement({
		repositoryId,
	}: RepositoryIdParams): Promise<GitHubMirrorEnablement | undefined> {
		const [source] = await this.db
			.select({
				installationId: repositoryExternalSources.installationId,
				mirrorMode: repositoryExternalSources.mirrorMode,
			})
			.from(repositoryExternalSources)
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github')
				)
			)
			.limit(1)

		return source
			? {
					installationId: source.installationId ?? undefined,
					mirrorMode: source.mirrorMode,
				}
			: undefined
	}

	async enableGitHubMirror({
		repositoryId,
		userId,
	}: RepositoryIdWithUserParams): Promise<boolean> {
		const [source] = await this.db
			.update(repositoryExternalSources)
			.set({
				mirrorMode: 'github_to_tessera',
				syncStatus: 'pending',
				requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
				syncFailureCount: 0,
				syncFailureCode: null,
				syncFailureReason: null,
				nextSyncAt: new Date(),
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github'),
					eq(repositoryExternalSources.mirrorMode, 'imported'),
					isNotNull(repositoryExternalSources.installationId),
					sql`exists (
						select 1
						from ${repositories}
						where ${repositories.id} = ${repositoryExternalSources.repositoryId}
							and ${repositories.ownerUserId} = ${userId}
					)`
				)
			)
			.returning({ id: repositoryExternalSources.id })

		return Boolean(source)
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
						inArray(repositoryExternalSources.mirrorMode, [
							'imported',
							'github_to_tessera',
						]),
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
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
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
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					...externalSourceParams,
					nextSyncAt: externalSourceParams.nextSyncAt,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			const repository = await this.updateImportStorageWithClient(transaction, {
				repositoryId,
				storagePath,
				defaultBranch,
				username,
			})

			if (!repository) return undefined

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
					eq(repositoryExternalSources.provider, 'github'),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
	}

	async cutoverGitHubMirror({
		actorUserId,
		cutoverAt,
		repositoryId,
		userId,
	}: CutoverGitHubMirrorParams): Promise<RepositoryWithOwner | undefined> {
		return await this.db.transaction(async transaction => {
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					mirrorMode: 'tessera_source',
					nextSyncAt: null,
					authorityGeneration: sql`${repositoryExternalSources.authorityGeneration} + 1`,
					syncLeaseOwner: null,
					syncLeaseAcquiredAt: null,
					syncLeaseExpiresAt: null,
					cutoverActorUserId: actorUserId,
					cutoverAt,
					cutoverFromMirrorMode: 'github_to_tessera',
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
						eq(repositoryExternalSources.syncStatus, 'succeeded'),
						sql`exists (
								select 1
								from ${repositories}
								where ${repositories.id} = ${repositoryExternalSources.repositoryId}
									and ${repositories.ownerUserId} = ${userId}
							)`
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			return await this.findWithClient(transaction, {
				userId,
				repositoryId,
			})
		})
	}

	async enableGitHubPushBack({
		repositoryId,
		userId,
	}: RepositoryIdWithUserParams): Promise<RepositoryWithOwner | undefined> {
		return await this.db.transaction(async transaction => {
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					githubPushBackEnabled: true,
					githubPushBackStatus: 'idle',
					githubPushBackFailedAt: null,
					githubPushBackFailureReason: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'tessera_source'),
						or(
							isNull(repositoryExternalSources.githubPushBackStatus),
							ne(repositoryExternalSources.githubPushBackStatus, 'running')
						),
						sql`exists (
									select 1
									from ${repositories}
								where ${repositories.id} = ${repositoryExternalSources.repositoryId}
									and ${repositories.ownerUserId} = ${userId}
							)`
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			return await this.findWithClient(transaction, { userId, repositoryId })
		})
	}

	async disableGitHubPushBack({
		repositoryId,
		userId,
	}: RepositoryIdWithUserParams): Promise<RepositoryWithOwner | undefined> {
		return await this.db.transaction(async transaction => {
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					githubPushBackEnabled: false,
					githubPushBackStatus: 'idle',
					githubPushBackStartedAt: null,
					githubPushBackFailedAt: null,
					githubPushBackFailureReason: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'tessera_source'),
						or(
							isNull(repositoryExternalSources.githubPushBackStatus),
							ne(repositoryExternalSources.githubPushBackStatus, 'running')
						),
						sql`exists (
									select 1
									from ${repositories}
								where ${repositories.id} = ${repositoryExternalSources.repositoryId}
									and ${repositories.ownerUserId} = ${userId}
							)`
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			return await this.findWithClient(transaction, { userId, repositoryId })
		})
	}

	async markGitHubPushBackRunning({
		repositoryId,
		startedAt,
		userId,
	}: MarkGitHubPushBackRunningParams): Promise<
		RepositoryWithOwner | undefined
	> {
		return await this.db.transaction(async transaction => {
			const [updatedExternalSource] = await transaction
				.update(repositoryExternalSources)
				.set({
					githubPushBackStatus: 'running',
					githubPushBackStartedAt: startedAt,
					githubPushBackFailedAt: null,
					githubPushBackFailureReason: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'tessera_source'),
						eq(repositoryExternalSources.githubPushBackEnabled, true),
						or(
							isNull(repositoryExternalSources.githubPushBackStatus),
							ne(repositoryExternalSources.githubPushBackStatus, 'running')
						),
						sql`exists (
									select 1
									from ${repositories}
								where ${repositories.id} = ${repositoryExternalSources.repositoryId}
									and ${repositories.ownerUserId} = ${userId}
							)`
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			return await this.findWithClient(transaction, { userId, repositoryId })
		})
	}

	async markGitHubPushBackSucceeded({
		repositoryId,
		succeededAt,
	}: MarkGitHubPushBackSucceededParams): Promise<void> {
		await this.db
			.update(repositoryExternalSources)
			.set({
				githubPushBackStatus: 'succeeded',
				githubPushBackSucceededAt: succeededAt,
				githubPushBackFailedAt: null,
				githubPushBackFailureReason: null,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github'),
					eq(repositoryExternalSources.mirrorMode, 'tessera_source')
				)
			)
	}

	async markGitHubPushBackFailed({
		failedAt,
		failureReason,
		repositoryId,
	}: MarkGitHubPushBackFailedParams): Promise<void> {
		await this.db
			.update(repositoryExternalSources)
			.set({
				githubPushBackStatus: 'failed',
				githubPushBackFailedAt: failedAt,
				githubPushBackFailureReason: failureReason,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.provider, 'github'),
					eq(repositoryExternalSources.mirrorMode, 'tessera_source')
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

	async listVisibleByOwner(
		params: ListVisibleByOwnerParams
	): Promise<OwnedRepositoryListItem[]> {
		const { viewerUserId } = params
		const isOwnedByHandle =
			params.ownerUserId === undefined
				? eq(repositories.ownerOrganizationId, params.ownerOrganizationId)
				: eq(repositories.ownerUserId, params.ownerUserId)
		const isPublic = eq(repositories.visibility, 'public')
		// An organization `member` is absent on purpose: TES-54 grants no implicit read.
		const isVisibleToViewer = viewerUserId
			? or(
					isPublic,
					eq(repositories.ownerUserId, viewerUserId),
					exists(
						this.db
							.select({ id: member.id })
							.from(member)
							.where(
								and(
									eq(member.organizationId, repositories.ownerOrganizationId),
									eq(member.userId, viewerUserId),
									inArray(member.role, ['owner', 'admin'])
								)
							)
					),
					exists(
						this.db
							.select({ id: repositoryCollaborators.id })
							.from(repositoryCollaborators)
							.where(
								and(
									eq(repositoryCollaborators.repositoryId, repositories.id),
									eq(repositoryCollaborators.userId, viewerUserId)
								)
							)
					)
				)
			: isPublic

		return await this.db
			.select({
				id: repositories.id,
				name: repositories.name,
				slug: repositories.slug,
				visibility: repositories.visibility,
			})
			.from(repositories)
			.where(
				and(
					isOwnedByHandle,
					isNotNull(repositories.storagePath),
					isVisibleToViewer
				)
			)
			.orderBy(asc(repositories.createdAt))
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
