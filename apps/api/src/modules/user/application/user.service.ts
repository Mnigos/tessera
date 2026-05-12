import { Injectable } from '@nestjs/common'
import type {
	PublicUserProfileInput,
	PublicUserProfileOutput,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { ProfileNotFoundError } from '../domain/user.errors'
import { UserRepository } from '../infrastructure/user.repository'

interface FindUserIdParams {
	username: string
}

@Injectable()
export class UserService {
	constructor(private readonly userRepository: UserRepository) {}

	async getProfile({
		username,
	}: PublicUserProfileInput): Promise<PublicUserProfileOutput> {
		const user = await this.userRepository.findProfile({ username })

		if (!user?.username) throw new ProfileNotFoundError(username)

		return {
			user: {
				id: user.id,
				username: user.username,
				displayName: user.name,
				avatarUrl: user.image ?? undefined,
			},
		}
	}

	async findUserId({ username }: FindUserIdParams): Promise<UserId> {
		const userId = await this.userRepository.findUserId({ username })

		if (!userId) throw new ProfileNotFoundError(username)

		return userId
	}
}
