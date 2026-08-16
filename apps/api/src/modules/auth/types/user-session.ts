import type { User } from '@repo/db/schema'
import type { OrganizationId } from '@repo/domain'

export interface UserSession {
	user: User
	session: {
		id: string
		userId: string
		expiresAt: Date
		/**
		 * Written by Better Auth's organization plugin, not by Tessera. It is
		 * declared so code that reads it does not need a cast; it is deliberately
		 * absent from the public auth contract, because which organization a
		 * session last looked at is not something the web decides anything from.
		 */
		activeOrganizationId?: OrganizationId | null
	}
}
