import type { OrganizationInvitation } from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { render, screen } from '@testing-library/react'
import { OrganizationInvitationsList } from './organization-invitations-list'

vi.mock('./organization-invitation-row', () => ({
	OrganizationInvitationRow: ({
		invitation,
	}: {
		invitation: OrganizationInvitation
	}) => <li>{invitation.email}</li>,
}))

const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const invitation: OrganizationInvitation = {
	id: '00000000-0000-4000-8000-000000000030' as OrganizationInvitationId,
	organizationId,
	email: 'recipient@example.com',
	role: 'member',
	status: 'pending',
	expiresAt: new Date('2026-08-18T10:00:00.000Z'),
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: 'owner',
		displayName: 'Owner Example',
	},
}

describe(OrganizationInvitationsList.name, () => {
	test('renders invitation rows', () => {
		render(
			<OrganizationInvitationsList
				invitations={[invitation]}
				isError={false}
				isLoading={false}
				organizationId={organizationId}
			/>
		)

		expect(screen.getByText('recipient@example.com')).toBeTruthy()
	})

	test('renders empty, loading, and error states', () => {
		const { rerender } = render(
			<OrganizationInvitationsList
				invitations={[]}
				isError={false}
				isLoading={false}
				organizationId={organizationId}
			/>
		)
		expect(screen.getByText('No invitations are waiting.')).toBeTruthy()

		rerender(
			<OrganizationInvitationsList
				invitations={undefined}
				isError={false}
				isLoading
				organizationId={organizationId}
			/>
		)
		expect(document.querySelectorAll('.animate-pulse')).toHaveLength(4)

		rerender(
			<OrganizationInvitationsList
				invitations={undefined}
				isError
				isLoading={false}
				organizationId={organizationId}
			/>
		)
		expect(screen.getByText('Invitations could not be loaded.')).toBeTruthy()
	})
})
