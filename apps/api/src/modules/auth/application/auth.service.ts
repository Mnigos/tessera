import { Injectable } from '@nestjs/common'
import type { UserSession } from '../types/user-session'

@Injectable()
export class AuthService {
	getSession(session?: UserSession) {
		return {
			user: session?.user
				? {
						id: session.user.id,
						email: session.user.email,
						displayName: session.user.name,
						avatarUrl: session.user.image ?? undefined,
					}
				: undefined,
		}
	}
}
