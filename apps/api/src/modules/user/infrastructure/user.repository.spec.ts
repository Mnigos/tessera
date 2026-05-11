import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
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

	afterEach(() => {
		moduleRef.close()
		vi.clearAllMocks()
	})

	test('finds a public profile by username', async () => {
		findFirstMock.mockResolvedValue({ username: 'github-user' })

		expect(
			await userRepository.findProfile({ username: 'github-user' })
		).toEqual({ username: 'github-user' })
		expect(findFirstMock).toHaveBeenCalledWith({
			where: expect.any(Object),
			columns: {
				id: true,
				username: true,
				name: true,
				image: true,
			},
		})
	})
})
