import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import {
	isOrganizationInvitationExpired,
	type MyOrganizationInvitationView,
	toMyOrganizationInvitationOutput,
	toOrganizationInvitationOutput,
} from './organization-invitation'

const expiresAt = new Date('2026-08-18T10:00:00.000Z')
const invitation: MyOrganizationInvitationView = {
	id: '00000000-0000-4000-8000-000000000030' as OrganizationInvitationId,
	organizationId: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	email: 'recipient@example.com',
	role: null,
	status: 'pending',
	expiresAt,
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: null,
		name: 'Owner',
	},
	organization: {
		id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
		slug: 'tessera',
		name: 'Tessera',
		createdAt: new Date('2026-08-15T10:00:00.000Z'),
	},
}

describe(toOrganizationInvitationOutput.name, () => {
	test('passes a nullable inviter username through and defaults a null role', () => {
		expect(toOrganizationInvitationOutput(invitation)).toMatchObject({
			id: invitation.id,
			role: 'member',
			inviter: { id: invitation.inviter.id, username: null },
		})
	})
})

describe(toMyOrganizationInvitationOutput.name, () => {
	test('includes the recipient-facing organization fields', () => {
		expect(toMyOrganizationInvitationOutput(invitation)).toMatchObject({
			organization: {
				id: invitation.organization.id,
				slug: 'tessera',
				name: 'Tessera',
			},
		})
	})
})

describe(isOrganizationInvitationExpired.name, () => {
	test('treats the exact expiry instant and earlier as expired', () => {
		expect(isOrganizationInvitationExpired(invitation, expiresAt)).toBeTruthy()
		expect(
			isOrganizationInvitationExpired(
				invitation,
				new Date(expiresAt.getTime() - 1)
			)
		).toBeFalsy()
	})
})
