import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { eq, user } from '@repo/db'
import type { UserId } from '@repo/domain'

interface FindProfileParams {
	username: string
}

interface FindUserIdParams {
	username: string
}

interface UserProfile {
	id: UserId
	username: string | null
	name: string
	image: string | null
}

@Injectable()
export class UserRepository {
	constructor(private readonly db: Database) {}

	findProfile({
		username,
	}: FindProfileParams): Promise<UserProfile | undefined> {
		return this.db.query.user.findFirst({
			where: eq(user.username, username),
			columns: {
				id: true,
				username: true,
				name: true,
				image: true,
			},
		})
	}

	async findUserId({
		username,
	}: FindUserIdParams): Promise<UserId | undefined> {
		const foundUser = await this.db.query.user.findFirst({
			where: eq(user.username, username),
			columns: {
				id: true,
			},
		})

		return foundUser?.id
	}
}
