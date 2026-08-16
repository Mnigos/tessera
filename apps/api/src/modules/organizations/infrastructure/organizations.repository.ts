import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
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
import type {
	OrganizationMembershipView,
	OrganizationView,
} from '../domain/organization'

interface OrganizationParams {
	organizationId: OrganizationId
}

interface UserParams {
	userId: UserId
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
	logo: organization.logo,
	createdAt: organization.createdAt,
}

@Injectable()
export class OrganizationsRepository {
	constructor(private readonly db: Database) {}

	async listMemberships({
		userId,
	}: UserParams): Promise<OrganizationMembershipView[]> {
		return await this.db
			.select({ ...ORGANIZATION_COLUMNS, role: member.role })
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(eq(member.userId, userId))
			.orderBy(asc(organization.name), asc(organization.slug))
	}

	async findById({
		organizationId,
	}: OrganizationParams): Promise<OrganizationView | undefined> {
		const [row] = await this.db
			.select(ORGANIZATION_COLUMNS)
			.from(organization)
			.where(eq(organization.id, organizationId))
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

	// Users and organizations share the /{handle} space, so both are checked.
	// Lowercasing forgoes the unique indexes, which stay case-sensitive until
	// TES-61 makes the shared namespace a database constraint.
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

	// Re-linking writes another row and nothing makes (userId, providerId)
	// unique, so the most recently updated account is the live one.
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

	// Every refusal is decided under the same `for update` lock the delete runs
	// under: a second owner can rename, demote the actor, or attach a repository
	// at any moment, and each would invalidate a check made beforehand.
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

			// A non-member is told the organization does not exist.
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

			// Better Auth's own delete is not used because it never asks what an
			// organization owns; members and invitations go explicitly so what is
			// removed is legible here rather than only in the schema.
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
