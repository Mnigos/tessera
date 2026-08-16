import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	type DrizzleTransaction,
	eq,
	inArray,
	isNotNull,
	isNull,
	type Member,
	member,
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
	type RepositoryOwnerIdentity,
	type RepositoryOwnerRow,
	type RepositoryWithOwner,
	toRepositoryWithOwner,
} from '../domain/repository'
import { RepositoryCreateFailedError } from '../domain/repository.errors'

interface HandleParams {
	handle: string
}

interface CreateParams {
	name: RepositoryName
	slug: RepositorySlug
	owner: RepositoryOwnerIdentity
	description?: string
	visibility?: RepositoryVisibility
}

interface FindParams extends HandleParams {
	slug: RepositorySlug
}

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

interface CutoverGitHubMirrorParams extends RepositoryIdParams {
	actorUserId: UserId
	cutoverAt: Date
}

interface UpdateStoragePathParams extends RepositoryIdParams {
	storagePath: string
}

interface UpdateImportStorageParams extends RepositoryIdParams {
	defaultBranch: string
	storagePath: string
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
	ownerHandle: sql<
		string | null
	>`coalesce(${user.username}, ${organization.slug})`,
	externalSource: REPOSITORY_EXTERNAL_SOURCE_COLUMNS,
}

@Injectable()
export class RepositoriesRepository {
	constructor(private readonly db: Database) {}

	async list(owner: RepositoryOwnerIdentity): Promise<RepositoryWithOwner[]> {
		const rows = await this.selectRepositories()
			.where(and(isOwnedBy(owner), isNotNull(repositories.storagePath)))
			.orderBy(asc(repositories.createdAt))

		return rows.flatMap(
			row => toRepositoryWithOwner(toRepositoryRow(row)) ?? []
		)
	}

	async find({
		handle,
		slug,
	}: FindParams): Promise<RepositoryWithOwner | undefined> {
		const [row] = await this.selectRepositories()
			.where(and(eq(repositories.slug, slug), isOwnerHandle(handle)))
			// A user handle wins a collision until one namespace holds both.
			.orderBy(sql`case when ${user.username} = ${handle} then 0 else 1 end`)
			.limit(1)

		return toRepositoryWithOwner(toRepositoryRow(row))
	}

	async findById({
		repositoryId,
	}: RepositoryIdParams): Promise<RepositoryWithOwner | undefined> {
		return await this.findByIdWithClient(this.db, repositoryId)
	}

	async findOwner({
		handle,
	}: HandleParams): Promise<RepositoryOwnerIdentity | undefined> {
		const [userOwner] = await this.db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.username, handle))
			.limit(1)

		if (userOwner)
			return { ownerUserId: userOwner.id, ownerOrganizationId: null }

		const [organizationOwner] = await this.db
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.slug, handle))
			.limit(1)

		if (!organizationOwner) return undefined

		return {
			ownerUserId: null,
			ownerOrganizationId: organizationOwner.id,
		}
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
		owner,
		slug,
		visibility,
	}: CreateParams): Promise<RepositoryWithOwner> {
		return await this.db.transaction(async transaction => {
			const [inserted] = await transaction
				.insert(repositories)
				.values({
					ownerUserId: owner.ownerUserId,
					ownerOrganizationId: owner.ownerOrganizationId,
					name,
					slug,
					description,
					visibility,
				})
				.returning({ id: repositories.id })

			if (!inserted) throw new RepositoryCreateFailedError()

			const repository = await this.findByIdWithClient(transaction, inserted.id)

			if (!repository) throw new RepositoryCreateFailedError()

			return repository
		})
	}

	async updateStoragePath({
		repositoryId,
		storagePath,
	}: UpdateStoragePathParams): Promise<RepositoryWithOwner | undefined> {
		const [updated] = await this.db
			.update(repositories)
			.set({ storagePath })
			.where(eq(repositories.id, repositoryId))
			.returning({ id: repositories.id })

		if (!updated) return undefined

		return await this.findByIdWithClient(this.db, repositoryId)
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
	}: RepositoryIdParams): Promise<boolean> {
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
					isNotNull(repositoryExternalSources.installationId)
				)
			)
			.returning({ id: repositoryExternalSources.id })

		return Boolean(source)
	}

	async cutoverGitHubMirror({
		actorUserId,
		cutoverAt,
		repositoryId,
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
						eq(repositoryExternalSources.syncStatus, 'succeeded')
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!updatedExternalSource) return undefined

			return await this.findByIdWithClient(transaction, repositoryId)
		})
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
		{ defaultBranch, repositoryId, storagePath }: UpdateImportStorageParams
	): Promise<RepositoryWithOwner | undefined> {
		const [updated] = await database
			.update(repositories)
			.set({ defaultBranch, storagePath })
			.where(eq(repositories.id, repositoryId))
			.returning({ id: repositories.id })

		if (!updated) return undefined

		return await this.findByIdWithClient(database, repositoryId)
	}

	private selectRepositories(database: RepositoryDatabase = this.db) {
		return database
			.select(REPOSITORY_WITH_OWNER_COLUMNS)
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
	}

	private async findByIdWithClient(
		database: RepositoryDatabase,
		repositoryId: RepositoryId
	): Promise<RepositoryWithOwner | undefined> {
		const [row] = await this.selectRepositories(database)
			.where(eq(repositories.id, repositoryId))
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
	ownerHandle: string | null
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
		ownerHandle: row.ownerHandle,
		externalSource: row.externalSource?.id ? row.externalSource : undefined,
	}
}

function isOwnerHandle(handle: string) {
	return or(eq(user.username, handle), eq(organization.slug, handle))
}

function isOwnedBy({
	ownerOrganizationId,
	ownerUserId,
}: RepositoryOwnerIdentity) {
	return and(
		ownerUserId
			? eq(repositories.ownerUserId, ownerUserId)
			: isNull(repositories.ownerUserId),
		ownerOrganizationId
			? eq(repositories.ownerOrganizationId, ownerOrganizationId)
			: isNull(repositories.ownerOrganizationId)
	)
}
