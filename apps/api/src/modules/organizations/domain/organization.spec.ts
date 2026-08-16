import type { OrganizationId } from '@repo/domain'
import { toOrganization } from './organization'

const createdAt = new Date('2026-08-16T10:00:00.000Z')

describe(toOrganization.name, () => {
	test('brands the Better Auth organization id and keeps the contract fields', () => {
		expect(
			toOrganization({
				id: '00000000-0000-4000-8000-000000000010',
				slug: 'tessera',
				name: 'Tessera',
				createdAt,
			})
		).toEqual({
			id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
			slug: 'tessera',
			name: 'Tessera',
			createdAt,
		})
	})
})
