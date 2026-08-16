import { ORPCError } from '@orpc/client'
import type { OrganizationId } from '@repo/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useInviteOrganizationMemberMutation } from '../hooks/use-invite-organization-member.mutation'
import { OrganizationInviteForm } from './organization-invite-form'

vi.mock('../hooks/use-invite-organization-member.mutation', () => ({
	useInviteOrganizationMemberMutation: vi.fn(),
}))

const useInviteOrganizationMemberMutationMock = vi.mocked(
	useInviteOrganizationMemberMutation
)
const mutate = vi.fn()
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId

function mockMutation(overrides: Record<string, unknown> = {}) {
	useInviteOrganizationMemberMutationMock.mockReturnValue({
		mutate,
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	} as never)
}

describe(OrganizationInviteForm.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockMutation()
	})

	test('offers owner only to an owner viewer', async () => {
		const user = userEvent.setup()
		const { unmount } = render(
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole="owner"
			/>
		)

		await user.click(screen.getByLabelText('Role'))
		expect(screen.getByRole('option', { name: 'owner' })).toBeTruthy()
		unmount()

		render(
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole="admin"
			/>
		)
		await user.click(screen.getByLabelText('Role'))
		expect(screen.queryByRole('option', { name: 'owner' })).toBeNull()
		expect(screen.getByRole('option', { name: 'admin' })).toBeTruthy()
		expect(screen.getByRole('option', { name: 'member' })).toBeTruthy()
	})

	test('submits a trimmed email with the default member role', async () => {
		const user = userEvent.setup()
		render(
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole="admin"
			/>
		)

		await user.type(screen.getByLabelText('Email'), '  recipient@example.com  ')
		const submitButton = screen.getByRole('button', {
			name: 'Send invitation',
		})
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)
		expect(mutate).toHaveBeenCalledWith(
			{
				organizationId,
				email: 'recipient@example.com',
				role: 'member',
			},
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
	})

	test('shows the API error copy', () => {
		mockMutation({
			isError: true,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: 'An invitation for this email is already pending.',
			}),
		})

		render(
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole="owner"
			/>
		)

		expect(screen.getByRole('alert').textContent).toContain(
			'An invitation for this email is already pending.'
		)
	})

	test('disables submission while pending', () => {
		mockMutation({ isPending: true })

		render(
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole="owner"
			/>
		)

		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Inviting' })
				.disabled
		).toBe(true)
	})
})
