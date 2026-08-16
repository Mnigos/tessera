import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	count,
	eq,
	invitation,
	member,
	organization,
	repositories,
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

/**
 * Why the deletion ended, decided entirely inside the locked transaction. The
 * service turns each of these into the error the person reads; none of them is
 * a judgement the repository makes on its own beyond what the rows say.
 */
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

	/**
	 * Deletes an organization, deciding every reason it might not be deleted
	 * from rows read under the same lock that the delete runs under.
	 *
	 * The lock is what makes the answer true rather than merely recent. A second
	 * owner can rename the organization, demote the actor, or attach a
	 * repository at any moment, and each of those would invalidate a check made
	 * beforehand — including the typed handle, which is compared against the
	 * slug this transaction actually holds. Attaching a repository takes a key
	 * share of this row, which `for update` conflicts with, so the count cannot
	 * go stale between reading it and acting on it either. Two concurrent
	 * deletions serialize: the second finds no row and reports `not-found`
	 * rather than a second success.
	 *
	 * Better Auth's own delete is not used because it never asks what an
	 * organization owns. Members and invitations are removed explicitly even
	 * though both cascade, so what this deletes is legible here rather than
	 * only in the schema.
	 */
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

			// A non-member is told the organization does not exist: which
			// organizations somebody belongs to is not a stranger's to confirm.
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
