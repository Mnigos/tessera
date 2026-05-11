import type { SessionUser } from '@repo/contracts'
import type { User } from '@repo/db/schema'

export function toSessionUser(user: User): SessionUser {
	return {
		id: user.id,
		email: user.email,
		username: user.username ?? undefined,
		displayName: user.name,
		avatarUrl: user.image ?? undefined,
	}
}
