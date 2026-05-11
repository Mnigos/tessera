import { db } from '@repo/db/client'
import { organizationMembers, organizations } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { eq } from 'drizzle-orm'

export class OrganizationsRepository {
	listForUser(userId: UserId) {
		return db
			.select({
				id: organizations.id,
				slug: organizations.slug,
				name: organizations.name,
			})
			.from(organizationMembers)
			.innerJoin(
				organizations,
				eq(organizations.id, organizationMembers.organizationId)
			)
			.where(eq(organizationMembers.userId, userId))
	}
}
