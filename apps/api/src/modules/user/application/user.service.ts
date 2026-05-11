import { Injectable } from '@nestjs/common'
import type {
	PublicUserProfileInput,
	PublicUserProfileOutput,
} from '@repo/contracts'
import { ProfileNotFoundError } from '../domain/user.errors'
import { UserRepository } from '../infrastructure/user.repository'

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
}
