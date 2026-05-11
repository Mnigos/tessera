import { NotFoundError } from '~/shared/errors'
import { ProfileNotFoundError } from './user.errors'

describe('user errors', () => {
	test('creates profile not found errors with username context', () => {
		const error = new ProfileNotFoundError('missing-user')

		expect(error).toBeInstanceOf(NotFoundError)
		expect(error.name).toBe('ProfileNotFoundError')
		expect(error.code).toBe('NOT_FOUND')
		expect(error.message).toBe('Profile not found')
		expect(error.context).toEqual({
			resource: 'profile',
			username: 'missing-user',
		})
	})
})
