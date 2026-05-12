import { Test, type TestingModule } from '@nestjs/testing'
import type { SessionOutput } from '@repo/contracts'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { AuthService } from './auth.service'

describe(AuthService.name, () => {
	let moduleRef: TestingModule
	let authService: AuthService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [AuthService],
		}).compile()

		authService = moduleRef.get(AuthService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('returns an empty session output when no session exists', () => {
		expect(authService.getSession()).toEqual({})
	})

	test('maps username into the product auth session output', () => {
		expect(
			authService.getSession(
				createMockSession({
					email: 'user@example.com',
					image: 'avatar.jpg',
					name: 'GitHub User',
					username: 'github-user',
				})
			) satisfies SessionOutput
		).toEqual({
			user: {
				id: mockUserId,
				email: 'user@example.com',
				username: 'github-user',
				displayName: 'GitHub User',
				avatarUrl: 'avatar.jpg',
			},
		})
	})

	test('omits absent avatar urls', () => {
		expect(authService.getSession(createMockSession())).toMatchObject({
			user: { avatarUrl: undefined },
		})
	})

	test('omits absent usernames', () => {
		const session = createMockSession({ username: null })

		expect(authService.getSession(session)).toMatchObject({
			user: { username: undefined },
		})
	})
})
