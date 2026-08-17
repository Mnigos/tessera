import type { MyOrganizationInvitation } from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useMyOrganizationInvitationsQuery } from '../hooks/use-my-organization-invitations.query'
import { PendingInvitationsMenu } from './pending-invitations-menu'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
	}: {
		children: ReactNode
		params: { invitationId: string }
	}) => <a href={`/invitations/${params.invitationId}`}>{children}</a>,
}))
vi.mock('../hooks/use-my-organization-invitations.query', () => ({
	useMyOrganizationInvitationsQuery: vi.fn(),
}))

const useMyOrganizationInvitationsQueryMock = vi.mocked(
	useMyOrganizationInvitationsQuery
)
const invitation: MyOrganizationInvitation = {
	id: '00000000-0000-4000-8000-000000000030' as OrganizationInvitationId,
	organizationId: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	email: 'recipient@example.com',
	role: 'member',
	status: 'pending',
	expiresAt: new Date(Date.now() + 86_400_000),
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: 'owner',
		displayName: 'Owner Example',
	},
	organization: {
		id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
		slug: 'tessera',
		name: 'Tessera',
	},
}

describe(PendingInvitationsMenu.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useMyOrganizationInvitationsQueryMock.mockReturnValue({
			data: { invitations: [invitation] },
		} as never)
	})

	test('renders a badge and links to pending invitations', async () => {
		const user = userEvent.setup()
		render(<PendingInvitationsMenu enabled />)

		const trigger = screen.getByRole('button', {
			name: '1 pending organization invitations',
		})
		expect(trigger.textContent).toContain('1')
		await user.click(trigger)
		expect(screen.getByText('Tessera').closest('a')?.getAttribute('href')).toBe(
			`/invitations/${invitation.id}`
		)
	})

	test('renders nothing when disabled or empty', () => {
		const { container, rerender } = render(
			<PendingInvitationsMenu enabled={false} />
		)
		expect(container.childElementCount).toBe(0)
		expect(useMyOrganizationInvitationsQueryMock).toHaveBeenCalledWith(false)

		useMyOrganizationInvitationsQueryMock.mockReturnValue({
			data: { invitations: [] },
		} as never)
		rerender(<PendingInvitationsMenu enabled />)
		expect(container.childElementCount).toBe(0)
	})
})
