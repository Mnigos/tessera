import { Injectable } from '@nestjs/common'
import { toSessionUser } from '../domain/user'
import type { UserSession } from '../types/user-session'

@Injectable()
export class AuthService {
	getSession(session?: UserSession) {
		return {
			user: session?.user ? toSessionUser(session.user) : undefined,
		}
	}
}
