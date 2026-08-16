import type { OrganizationMember } from '@repo/contracts'
import type {
	OrganizationMemberId,
	OrganizationRole,
	UserId,
} from '@repo/domain'
import {
	countOrganizationOwners,
	getOrganizationMemberPermissions,
} from './get-organization-member-permissions'

const viewerUserId = '00000000-0000-4000-8000-000000000001' as UserId

function createMember(
	role: OrganizationRole,
	userId: UserId = '00000000-0000-4000-8000-000000000002' as UserId
): OrganizationMember {
	return {
		id: crypto.randomUUID() as OrganizationMemberId,
		role,
		createdAt: new Date('2026-08-16T10:00:00.000Z'),
		user: {
			id: userId,
			username: 'anna',
			displayName: 'Anna',
		},
	}
}

describe(getOrganizationMemberPermissions.name, () => {
	test('disables every action for the last owner viewing themselves', () => {
		expect(
			getOrganizationMemberPermissions({
				member: createMember('owner', viewerUserId),
				ownerCount: 1,
				viewerRole: 'owner',
				viewerUserId,
			})
		).toEqual({
			isViewer: true,
			canChangeRole: false,
			canRemove: false,
			canLeave: false,
			restriction: 'An organization needs at least one owner.',
		})
	})

	test('offers Leave to a viewer who is not the last owner', () => {
		expect(
			getOrganizationMemberPermissions({
				member: createMember('admin', viewerUserId),
				ownerCount: 1,
				viewerRole: 'admin',
				viewerUserId,
			})
		).toMatchObject({
			isViewer: true,
			canRemove: false,
			canLeave: true,
		})
	})

	test('prevents an admin from managing an owner', () => {
		expect(
			getOrganizationMemberPermissions({
				member: createMember('owner'),
				ownerCount: 2,
				viewerRole: 'admin',
				viewerUserId,
			})
		).toEqual({
			isViewer: false,
			canChangeRole: false,
			canRemove: false,
			canLeave: false,
			restriction: 'Only owners can manage owners.',
		})
	})

	test('prevents a member from managing another member', () => {
		expect(
			getOrganizationMemberPermissions({
				member: createMember('member'),
				ownerCount: 1,
				viewerRole: 'member',
				viewerUserId,
			})
		).toEqual({
			isViewer: false,
			canChangeRole: false,
			canRemove: false,
			canLeave: false,
		})
	})

	test('allows an owner to manage a non-owner', () => {
		expect(
			getOrganizationMemberPermissions({
				member: createMember('admin'),
				ownerCount: 1,
				viewerRole: 'owner',
				viewerUserId,
			})
		).toEqual({
			isViewer: false,
			canChangeRole: true,
			canRemove: true,
			canLeave: false,
		})
	})
})

describe(countOrganizationOwners.name, () => {
	test('counts only owner memberships', () => {
		expect(
			countOrganizationOwners([
				createMember('owner'),
				createMember('admin'),
				createMember('owner'),
			])
		).toBe(2)
	})
})
