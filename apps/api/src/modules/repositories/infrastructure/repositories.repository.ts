import { db } from '@repo/db/client'
import { organization, repositories, user } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { eq } from 'drizzle-orm'

export class RepositoriesRepository {
	listForUser(userId: UserId) {
		return db
			.select({
				id: repositories.id,
				ownerUserName: user.username,
				ownerUserDisplayName: user.name,
				ownerOrganizationSlug: organization.slug,
				name: repositories.name,
				visibility: repositories.visibility,
				description: repositories.description,
				updatedAt: repositories.updatedAt,
			})
			.from(repositories)
			.leftJoin(user, eq(user.id, repositories.ownerUserId))
			.leftJoin(
				organization,
				eq(organization.id, repositories.ownerOrganizationId)
			)
			.where(eq(repositories.ownerUserId, userId))
	}
}
