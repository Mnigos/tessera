import type { User } from '@repo/db/schema'

export interface UserSession {
	user: User
	session: {
		id: string
		userId: string
		expiresAt: Date
	}
}
