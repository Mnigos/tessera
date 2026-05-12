import type { UserSession } from '@modules/auth'
import type { UserId } from '@repo/domain'

interface CreateMockSessionOptions {
	userId?: UserId
	email?: string
	name?: string
	image?: string | null
	username?: string | null
	createdAt?: Date
	updatedAt?: Date
	expiresAt?: Date
}

export const mockUserId = '00000000-0000-4000-8000-000000000001' as UserId

export function createMockSession(
	options: CreateMockSessionOptions = {}
): UserSession {
	const userId = options.userId ?? mockUserId
	const createdAt = options.createdAt ?? new Date('2026-05-12T00:00:00Z')
	const updatedAt = options.updatedAt ?? createdAt

	return {
		user: {
			id: userId,
			email: options.email ?? 'marta@example.com',
			name: options.name ?? 'Marta',
			emailVerified: true,
			image: options.image ?? null,
			username: options.username === undefined ? 'marta' : options.username,
			createdAt,
			updatedAt,
		},
		session: {
			id: '00000000-0000-4000-8000-000000000003',
			userId,
			expiresAt: options.expiresAt ?? new Date('2026-05-13T00:00:00Z'),
		},
	}
}
