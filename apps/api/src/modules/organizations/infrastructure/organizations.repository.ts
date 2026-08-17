import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { Organization, OrganizationMembership } from '@repo/contracts'
import {
	account,
	and,
	asc,
	count,
	desc,
	eq,
	invitation,
	member,
	ne,
	organization,
	repositories,
	sql,
	user,
} from '@repo/db'
import type { OrganizationId, OrganizationRole, UserId } from '@repo/domain'
import { OrganizationBusyError } from '../domain/organization.errors'

interface OrganizationParams {
	organizationId: OrganizationId
}

interface UserParams {
	userId: UserId
}

interface OrganizationSlugParams {
	slug: string
}

interface MemberRoleParams extends OrganizationParams, UserParams {}

interface DeleteOrganizationParams extends MemberRoleParams {
	confirmationSlug: string
}

interface IsHandleTakenParams {
	handle: string
	ignoreOrganizationId?: OrganizationId
}

export interface GitHubAccountIdentity {
	accountId: string
	accessToken: string | null
	accessTokenExpiresAt: Date | null
}

export type OrganizationDeletionResult =
	| { kind: 'deleted' }
	| { kind: 'not-found' }
	| { kind: 'forbidden'; actorRole: OrganizationRole }
	| { kind: 'confirmation-mismatch' }
	| { kind: 'has-repositories'; repositoryCount: number }

const ORGANIZATION_COLUMNS = {
	id: organization.id,
	slug: organization.slug,
	name: organization.name,
	createdAt: organization.createdAt,
}

@Injectable()
export class OrganizationsRepository {
	constructor(private readonly db: Database) {}

	async listMemberships({
		userId,
	}: UserParams): Promise<OrganizationMembership[]> {
		return await this.db
			.select({ ...ORGANIZATION_COLUMNS, role: member.role })
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(eq(member.userId, userId))
			.orderBy(asc(organization.name), asc(organization.slug))
	}

	async findById({
		organizationId,
	}: OrganizationParams): Promise<Organization | undefined> {
		const [row] = await this.db
			.select(ORGANIZATION_COLUMNS)
			.from(organization)
			.where(eq(organization.id, organizationId))
			.limit(1)

		return row
	}

	// Never waits: `run` needs a second pool connection, so waiters would starve it.
	async withOrganizationLock<TResult>(
		organizationId: OrganizationId,
		run: () => Promise<TResult>
	): Promise<TResult> {
		return await this.db.transaction(async transaction => {
			const [lock] = await transaction.execute<{ locked: boolean }>(
				sql`select pg_try_advisory_xact_lock(hashtextextended(${`organization:${organizationId}`}, 0)) as locked`
			)

			if (!lock?.locked) throw new OrganizationBusyError({ organizationId })

			return await run()
		})
	}

	async findBySlug({
		slug,
	}: OrganizationSlugParams): Promise<Organization | undefined> {
		const [row] = await this.db
			.select(ORGANIZATION_COLUMNS)
			.from(organization)
			.where(eq(organization.slug, slug))
			.limit(1)

		return row
	}

	async findMemberRole({
		organizationId,
		userId,
	}: MemberRoleParams): Promise<OrganizationRole | undefined> {
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

	// Case-insensitive across users and organizations; DB-level uniqueness is TES-61.
	async isHandleTaken({
		handle,
		ignoreOrganizationId,
	}: IsHandleTakenParams): Promise<boolean> {
		const organizationHandleTaken = sql`lower(${organization.slug}) = lower(${handle})`

		const [takenUsernames, takenSlugs] = await Promise.all([
			this.db
				.select({ id: user.id })
				.from(user)
				.where(sql`lower(${user.username}) = lower(${handle})`)
				.limit(1),
			this.db
				.select({ id: organization.id })
				.from(organization)
				.where(
					ignoreOrganizationId
						? and(
								organizationHandleTaken,
								ne(organization.id, ignoreOrganizationId)
							)
						: organizationHandleTaken
				)
				.limit(1),
		])

		return takenUsernames.length > 0 || takenSlugs.length > 0
	}

	// Re-linking can leave several rows; the newest wins.
	async findGitHubAccount({
		userId,
	}: UserParams): Promise<GitHubAccountIdentity | undefined> {
		return await this.db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
			orderBy: [desc(account.updatedAt)],
			columns: {
				accountId: true,
				accessToken: true,
				accessTokenExpiresAt: true,
			},
		})
	}

	// Every check runs under the row lock so a concurrent rename or demotion
	// cannot slip between check and delete.
	async deleteOwned({
		confirmationSlug,
		organizationId,
		userId,
	}: DeleteOrganizationParams): Promise<OrganizationDeletionResult> {
		return await this.db.transaction(async transaction => {
			const [lockedOrganization] = await transaction
				.select({ slug: organization.slug })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.limit(1)
				.for('update')

			if (!lockedOrganization) return { kind: 'not-found' }

			const [actorMember] = await transaction
				.select({ role: member.role })
				.from(member)
				.where(
					and(
						eq(member.organizationId, organizationId),
						eq(member.userId, userId)
					)
				)
				.limit(1)

			if (!actorMember) return { kind: 'not-found' }

			if (actorMember.role !== 'owner')
				return { kind: 'forbidden', actorRole: actorMember.role }

			if (confirmationSlug !== lockedOrganization.slug)
				return { kind: 'confirmation-mismatch' }

			const [repositoryCount] = await transaction
				.select({ value: count() })
				.from(repositories)
				.where(eq(repositories.ownerOrganizationId, organizationId))

			const ownedRepositories = repositoryCount?.value ?? 0
			if (ownedRepositories > 0)
				return { kind: 'has-repositories', repositoryCount: ownedRepositories }

			await transaction
				.delete(invitation)
				.where(eq(invitation.organizationId, organizationId))
			await transaction
				.delete(member)
				.where(eq(member.organizationId, organizationId))
			await transaction
				.delete(organization)
				.where(eq(organization.id, organizationId))

			return { kind: 'deleted' }
		})
	}
}
