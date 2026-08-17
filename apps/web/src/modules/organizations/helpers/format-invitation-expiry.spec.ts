import { formatInvitationExpiry } from './format-invitation-expiry'

const now = new Date('2026-08-16T10:00:00.000Z')

describe(formatInvitationExpiry.name, () => {
	test.each([
		[new Date('invalid'), 'unknown'],
		[new Date('2026-08-16T10:00:00.000Z'), 'expired'],
		[new Date('2026-08-16T09:59:59.999Z'), 'expired'],
		[new Date('2026-08-18T10:00:00.000Z'), 'in 2 days'],
		[new Date('2026-08-16T12:00:00.000Z'), 'in 2 hours'],
		[new Date('2026-08-16T10:00:01.000Z'), 'in 1 minute'],
	] as const)('formats %s as %s', (expiresAt, expected) => {
		expect(formatInvitationExpiry(expiresAt, now)).toBe(expected)
	})
})
