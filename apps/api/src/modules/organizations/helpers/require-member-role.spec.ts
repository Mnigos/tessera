import type { OrganizationId, UserId } from '@repo/domain'
import {
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import type { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { requireManagerRole, requireMemberRole } from './require-member-role'

const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const userId = '00000000-0000-4000-8000-000000000001' as UserId
const params = { organizationId, userId }

function createRepository(role: 'owner' | 'admin' | 'member' | undefined) {
	return {
		findMemberRole: vi.fn().mockResolvedValue(role),
	} as unknown as OrganizationsRepository
}

describe(requireMemberRole.name, () => {
	test.each([
		'owner',
		'admin',
		'member',
	] as const)('returns the %s membership role', async role => {
		expect(await requireMemberRole(createRepository(role), params)).toBe(role)
	})

	test('masks a missing membership as organization not found', async () => {
		await expect(
			requireMemberRole(createRepository(undefined), params)
		).rejects.toBeInstanceOf(OrganizationNotFoundError)
	})
})

describe(requireManagerRole.name, () => {
	test.each(['owner', 'admin'] as const)('allows a %s', async role => {
		expect(await requireManagerRole(createRepository(role), params)).toBe(role)
	})

	test('rejects a member', async () => {
		await expect(
			requireManagerRole(createRepository('member'), params)
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
	})
})
