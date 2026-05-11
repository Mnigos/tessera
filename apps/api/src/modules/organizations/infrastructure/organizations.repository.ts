import { db } from '@repo/db/client'
import { member, organization } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { eq } from 'drizzle-orm'

export class OrganizationsRepository {
	listForUser(userId: UserId) {
		return db
			.select({
				id: organization.id,
				slug: organization.slug,
				name: organization.name,
			})
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(eq(member.userId, userId))
	}
}
