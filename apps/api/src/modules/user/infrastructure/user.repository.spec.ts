import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq, user } from '@repo/db'
import { UserRepository } from './user.repository'

describe(UserRepository.name, () => {
	let moduleRef: TestingModule
	let userRepository: UserRepository

	const findFirstMock = vi.fn()

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				UserRepository,
				{
					provide: Database,
					useValue: {
						query: {
							user: {
								findFirst: findFirstMock,
							},
						},
					},
				},
			],
		}).compile()

		userRepository = moduleRef.get(UserRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('finds a public profile by username', async () => {
		findFirstMock.mockResolvedValue({ username: 'github-user' })

		expect(
			await userRepository.findProfile({ username: 'github-user' })
		).toEqual({ username: 'github-user' })
		expect(findFirstMock).toHaveBeenCalledWith({
			where: eq(user.username, 'github-user'),
			columns: {
				id: true,
				username: true,
				name: true,
				image: true,
			},
		})
	})

	test('finds a user id by username', async () => {
		findFirstMock.mockResolvedValue({
			id: '00000000-0000-4000-8000-000000000001',
		})

		expect(await userRepository.findUserId({ username: 'github-user' })).toBe(
			'00000000-0000-4000-8000-000000000001'
		)
		expect(findFirstMock).toHaveBeenCalledWith({
			where: eq(user.username, 'github-user'),
			columns: {
				id: true,
			},
		})
	})

	test('returns undefined when a user id cannot be found', async () => {
		findFirstMock.mockResolvedValue(undefined)

		expect(
			await userRepository.findUserId({ username: 'missing-user' })
		).toBeUndefined()
	})
})
