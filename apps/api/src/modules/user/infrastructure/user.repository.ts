import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { eq, user } from '@repo/db'

interface FindProfileParams {
	username: string
}

@Injectable()
export class UserRepository {
	constructor(private readonly db: Database) {}

	findProfile({ username }: FindProfileParams) {
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
}
