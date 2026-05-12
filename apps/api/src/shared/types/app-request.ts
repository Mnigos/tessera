import type { UserSession } from '@modules/auth'
import type { UserId } from '@repo/domain'
import type { HonoRequest } from 'hono'

export interface AppRequest extends HonoRequest {
	params?: Record<string, string>
	session?: UserSession
	targetUserId?: UserId
	viewerUserId?: UserId
}
