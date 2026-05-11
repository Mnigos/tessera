import { db } from '@repo/db/client'
import { type User, user } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { eq } from 'drizzle-orm'

export class UsersRepository {
	async findById(userId: UserId): Promise<User | undefined> {
		const [record] = await db.select().from(user).where(eq(user.id, userId))

		return record
	}
}
