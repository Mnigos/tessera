import { NotFoundError } from '~/shared/errors'

export class ProfileNotFoundError extends NotFoundError {
	constructor(username: string) {
		super('profile', { username }, 'Profile not found')
	}
}
