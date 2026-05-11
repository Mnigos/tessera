import { Test, type TestingModule } from '@nestjs/testing'
import type { SessionOutput } from '@repo/contracts'
import type { UserId } from '@repo/domain'
import type { UserSession } from '../types/user-session'
import { AuthService } from './auth.service'

const userId = '00000000-0000-4000-8000-000000000001' as UserId
const now = new Date('2026-01-01T00:00:00.000Z')

function createSession(image: string | null): UserSession {
	return {
		user: {
			id: userId,
			name: 'GitHub User',
			email: 'user@example.com',
			emailVerified: true,
			image,
			username: 'github-user',
			createdAt: now,
			updatedAt: now,
		},
		session: {
			id: '00000000-0000-4000-8000-000000000901',
			userId,
			expiresAt: now,
		},
	}
}

describe(AuthService.name, () => {
	let moduleRef: TestingModule
	let authService: AuthService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [AuthService],
		}).compile()

		authService = moduleRef.get(AuthService)
	})

	afterEach(() => {
		moduleRef.close()
		vi.clearAllMocks()
	})

	test('returns an empty session output when no session exists', () => {
		expect(authService.getSession()).toEqual({})
	})

	test('maps username into the product auth session output', () => {
		expect(
			authService.getSession(
				createSession('avatar.jpg')
			) satisfies SessionOutput
		).toEqual({
			user: {
				id: userId,
				email: 'user@example.com',
				username: 'github-user',
				displayName: 'GitHub User',
				avatarUrl: 'avatar.jpg',
			},
		})
	})

	test('omits absent avatar urls', () => {
		expect(authService.getSession(createSession(null))).toMatchObject({
			user: { avatarUrl: undefined },
		})
	})

	test('omits absent usernames', () => {
		const session = createSession(null)
		session.user.username = null

		expect(authService.getSession(session)).toMatchObject({
			user: { username: undefined },
		})
	})
})
