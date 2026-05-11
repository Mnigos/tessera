import type { UserSession } from '@modules/auth'
import { Injectable } from '@nestjs/common'

@Injectable()
export class UsersService {
	getViewer(session?: UserSession) {
		return {
			user: session?.user
				? {
						id: session.user.id,
						username: session.user.username ?? session.user.name,
						displayName: session.user.name,
						avatarUrl: session.user.image ?? undefined,
					}
				: undefined,
		}
	}
}
