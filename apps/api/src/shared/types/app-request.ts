import type { UserSession } from '@modules/auth'
import type { HonoRequest } from 'hono'

export interface AppRequest extends HonoRequest {
	/** Lowercased by the adapter, which builds them from the fetch `Headers`. */
	headers?: Record<string, string>
	params?: Record<string, string>
	session?: UserSession
}
