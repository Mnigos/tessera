import type { User } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { toSessionUser } from './user'

const now = new Date('2026-01-01T00:00:00.000Z')

describe(toSessionUser.name, () => {
	test('creates a session user from persisted auth user fields', () => {
		expect(
			toSessionUser({
				id: '00000000-0000-4000-8000-000000000001' as UserId,
				name: 'GitHub User',
				email: 'user@example.com',
				emailVerified: true,
				image: 'avatar.jpg',
				username: 'github-user',
				createdAt: now,
				updatedAt: now,
			} satisfies User)
		).toEqual({
			id: '00000000-0000-4000-8000-000000000001',
			email: 'user@example.com',
			username: 'github-user',
			displayName: 'GitHub User',
			avatarUrl: 'avatar.jpg',
		})
	})

	test('omits absent usernames', () => {
		expect(
			toSessionUser({
				id: '00000000-0000-4000-8000-000000000001' as UserId,
				name: 'GitHub User',
				email: 'user@example.com',
				emailVerified: true,
				image: null,
				username: null,
				createdAt: now,
				updatedAt: now,
			} satisfies User)
		).toMatchObject({ username: undefined })
	})
})
