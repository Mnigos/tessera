import { Test, type TestingModule } from '@nestjs/testing'
import { UserService } from '../application/user.service'
import { UserController } from './user.controller'

describe(UserController.name, () => {
	let moduleRef: TestingModule
	let userController: UserController

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
	})

	afterEach(() => {
		moduleRef.close()
		vi.clearAllMocks()
	})

	test('is defined', () => {
		expect(userController).toBeDefined()
	})
})
