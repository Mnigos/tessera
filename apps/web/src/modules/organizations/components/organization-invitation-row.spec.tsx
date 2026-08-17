import { ORPCError } from '@orpc/client'
import type { OrganizationInvitation } from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCancelOrganizationInvitationMutation } from '../hooks/use-cancel-organization-invitation.mutation'
import { useResendOrganizationInvitationMutation } from '../hooks/use-resend-organization-invitation.mutation'
import { OrganizationInvitationRow } from './organization-invitation-row'

vi.mock('../hooks/use-cancel-organization-invitation.mutation', () => ({
	useCancelOrganizationInvitationMutation: vi.fn(),
}))
vi.mock('../hooks/use-resend-organization-invitation.mutation', () => ({
	useResendOrganizationInvitationMutation: vi.fn(),
}))

const useCancelOrganizationInvitationMutationMock = vi.mocked(
	useCancelOrganizationInvitationMutation
)
const useResendOrganizationInvitationMutationMock = vi.mocked(
	useResendOrganizationInvitationMutation
)
const resend = vi.fn()
const cancel = vi.fn()
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const invitation: OrganizationInvitation = {
	id: '00000000-0000-4000-8000-000000000030' as OrganizationInvitationId,
	organizationId,
	email: 'recipient@example.com',
	role: 'admin',
	status: 'pending',
	expiresAt: new Date(Date.now() + 86_400_000),
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: 'owner',
		displayName: 'Owner Example',
	},
}

function mockMutations() {
	useResendOrganizationInvitationMutationMock.mockReturnValue({
		mutate: resend,
		isPending: false,
		isError: false,
		error: null,
	} as never)
	useCancelOrganizationInvitationMutationMock.mockReturnValue({
		mutate: cancel,
		isPending: false,
		isError: false,
		error: null,
	} as never)
}

describe(OrganizationInvitationRow.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockMutations()
	})

	test('copies the invitation link', async () => {
		const user = userEvent.setup()
		const writeTextSpy = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockResolvedValue()
		render(
			<OrganizationInvitationRow
				invitation={invitation}
				organizationId={organizationId}
			/>
		)

		await user.click(
			screen.getByRole('button', {
				name: 'Copy invitation link for recipient@example.com',
			})
		)

		expect(writeTextSpy).toHaveBeenCalledWith(
			`${window.location.origin}/invitations/${invitation.id}`
		)
		expect(screen.getByText('Copied')).toBeTruthy()
	})

	test('resends and cancels the invitation', async () => {
		const user = userEvent.setup()
		render(
			<OrganizationInvitationRow
				invitation={invitation}
				organizationId={organizationId}
			/>
		)

		await user.click(
			screen.getByRole('button', {
				name: 'Resend invitation for recipient@example.com',
			})
		)
		await user.click(
			screen.getByRole('button', {
				name: 'Cancel invitation for recipient@example.com',
			})
		)

		expect(resend).toHaveBeenCalledWith({
			organizationId,
			invitationId: invitation.id,
		})
		expect(cancel).toHaveBeenCalledWith({
			organizationId,
			invitationId: invitation.id,
		})
	})

	test('shows mutation error copy', () => {
		useResendOrganizationInvitationMutationMock.mockReturnValue({
			mutate: resend,
			isPending: false,
			isError: true,
			error: new ORPCError('NOT_FOUND', {
				status: 404,
				message: 'Invitation not found.',
			}),
		} as never)

		render(
			<OrganizationInvitationRow
				invitation={invitation}
				organizationId={organizationId}
			/>
		)

		expect(screen.getByRole('alert').textContent).toContain(
			'This invitation could not be updated.'
		)
	})
})
