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

/**
 * Everything a value would expose to anything that inspects it: own properties,
 * the message and stack of an error, and the whole `cause` chain. Asserting on
 * one field proves only that field is clean, and a provider error attached as a
 * cause is exactly the leak that survives a tidy-looking context.
 */
export function sweepValue(value: unknown, depth = 0): string {
	const MAX_DEPTH = 8

	if (depth > MAX_DEPTH || value === null || value === undefined) return ''
	if (typeof value !== 'object')
		return typeof value === 'bigint' ? value.toString() : String(value)

	const parts: string[] = []

	if (value instanceof Error)
		parts.push(value.name, value.message, value.stack ?? '')

	for (const nested of Object.values(value))
		parts.push(sweepValue(nested, depth + 1))
	if ('cause' in value) parts.push(sweepValue(value.cause, depth + 1))

	return parts.join(' ')
}

/** Whether none of the given secrets appear anywhere inside a value. */
export function isSecretFree(value: unknown, secrets: string[]): boolean {
	const swept = sweepValue(value)

	return secrets.every(secret => !swept.includes(secret))
}

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
