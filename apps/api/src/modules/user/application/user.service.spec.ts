import { Test, type TestingModule } from '@nestjs/testing'
import type { UserId } from '@repo/domain'
import { ProfileNotFoundError } from '../domain/user.errors'
import { UserRepository } from '../infrastructure/user.repository'
import { UserService } from './user.service'

const userId = '00000000-0000-4000-8000-000000000001' as UserId

describe(UserService.name, () => {
	let moduleRef: TestingModule
	let userService: UserService
	let userRepository: UserRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				UserService,
				{
					provide: UserRepository,
					useValue: {
						findProfile: vi.fn(),
						findUserId: vi.fn(),
					},
				},
			],
		}).compile()

		userService = moduleRef.get(UserService)
		userRepository = moduleRef.get(UserRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('returns a public profile for a matching username', async () => {
		const findProfileSpy = vi
			.spyOn(userRepository, 'findProfile')
			.mockResolvedValue({
				id: userId,
				username: 'github-user',
				name: 'GitHub User',
				image: 'avatar.jpg',
			})

		expect(await userService.getProfile({ username: 'github-user' })).toEqual({
			user: {
				id: userId,
				username: 'github-user',
				displayName: 'GitHub User',
				avatarUrl: 'avatar.jpg',
			},
		})
		expect(findProfileSpy).toHaveBeenCalledWith({ username: 'github-user' })
	})

	test('omits absent avatar urls', async () => {
		vi.spyOn(userRepository, 'findProfile').mockResolvedValue({
			id: userId,
			username: 'github-user',
			name: 'GitHub User',
			image: null,
		})

		expect(await userService.getProfile({ username: 'github-user' })).toEqual({
			user: expect.objectContaining({ avatarUrl: undefined }),
		})
	})

	test('throws ProfileNotFoundError when the username does not exist', async () => {
		vi.spyOn(userRepository, 'findProfile').mockResolvedValue(undefined)

		const promise = userService.getProfile({ username: 'missing-user' })

		await expect(promise).rejects.toBeInstanceOf(ProfileNotFoundError)
		await expect(promise).rejects.toMatchObject({
			code: 'NOT_FOUND',
			context: {
				resource: 'profile',
				username: 'missing-user',
			},
		})
	})

	test('finds a user id by username', async () => {
		const findUserIdSpy = vi
			.spyOn(userRepository, 'findUserId')
			.mockResolvedValue(userId)

		expect(await userService.findUserId({ username: 'github-user' })).toBe(
			userId
		)
		expect(findUserIdSpy).toHaveBeenCalledWith({ username: 'github-user' })
	})

	test('throws ProfileNotFoundError when finding a missing user id', async () => {
		vi.spyOn(userRepository, 'findUserId').mockResolvedValue(undefined)

		await expect(
			userService.findUserId({ username: 'missing-user' })
		).rejects.toBeInstanceOf(ProfileNotFoundError)
	})
})
