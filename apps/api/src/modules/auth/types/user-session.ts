import type { User } from '@repo/db/schema'
import type { OrganizationId } from '@repo/domain'

export interface UserSession {
	user: User
	session: {
		id: string
		userId: string
		expiresAt: Date
		activeOrganizationId?: OrganizationId | null
	}
}
