import type {
	OrganizationMemberId,
	OrganizationRole,
	UserId,
} from '@repo/domain'
import {
	type OrganizationMemberView,
	toOrganizationMemberOutput,
} from './organization-member'

const memberView: OrganizationMemberView = {
	id: '00000000-0000-4000-8000-000000000020' as OrganizationMemberId,
	role: 'admin' as OrganizationRole,
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	user: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: null,
		name: 'Anna Example',
		image: null,
	},
}

describe(toOrganizationMemberOutput.name, () => {
	test('passes a nullable username through without fabricating a handle', () => {
		expect(toOrganizationMemberOutput(memberView)).toEqual({
			id: memberView.id,
			role: 'admin',
			createdAt: memberView.createdAt,
			user: {
				id: memberView.user.id,
				username: null,
				displayName: 'Anna Example',
				avatarUrl: undefined,
			},
		})
	})
})
