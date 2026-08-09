import type { UserSession } from '@modules/auth'
import type { UserId } from '@repo/domain'
import type { HonoRequest } from 'hono'

export interface AppRequest extends HonoRequest {
	/** Lowercased by the adapter, which builds them from the fetch `Headers`. */
	headers?: Record<string, string>
	params?: Record<string, string>
	session?: UserSession
	targetUserId?: UserId
	viewerUserId?: UserId
}
