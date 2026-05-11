import { Test, type TestingModule } from '@nestjs/testing'
import type { UserId } from '@repo/domain'
import { UserService } from '../application/user.service'
import { UserController } from './user.controller'

describe(UserController.name, () => {
	let moduleRef: TestingModule
	let userController: UserController
	let userService: UserService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [UserController],
			providers: [
				{
					provide: UserService,
					useValue: {
						getProfile: vi.fn(),
					},
				},
			],
		}).compile()

		userController = moduleRef.get(UserController)
		userService = moduleRef.get(UserService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('is defined', () => {
		expect(userController).toBeDefined()
	})

	test('delegates profile requests to the user service', async () => {
		const output = {
			user: {
				id: '00000000-0000-4000-8000-000000000001' as UserId,
				username: 'github-user',
				displayName: 'GitHub User',
				avatarUrl: undefined,
			},
		}
		const getProfileSpy = vi
			.spyOn(userService, 'getProfile')
			.mockResolvedValue(output)

		expect(
			await userController.getProfile()['~orpc'].handler({
				input: { username: 'github-user' },
				context: {},
				path: ['user', 'profile'],
				procedure: userController.getProfile(),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(output)
		expect(getProfileSpy).toHaveBeenCalledWith({ username: 'github-user' })
	})
})
