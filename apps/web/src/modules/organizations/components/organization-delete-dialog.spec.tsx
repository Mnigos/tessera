import { ORPCError } from '@orpc/client'
import type { Organization } from '@repo/contracts'
import type { OrganizationId } from '@repo/domain'
import { useNavigate } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDeleteOrganizationMutation } from '../hooks/use-delete-organization.mutation'
import { OrganizationDeleteDialog } from './organization-delete-dialog'

vi.mock('@tanstack/react-router', () => ({ useNavigate: vi.fn() }))
vi.mock('../hooks/use-delete-organization.mutation', () => ({
	useDeleteOrganizationMutation: vi.fn(),
}))

const useNavigateMock = vi.mocked(useNavigate)
const useDeleteOrganizationMutationMock = vi.mocked(
	useDeleteOrganizationMutation
)
const navigate = vi.fn()
const mutate = vi.fn()
const reset = vi.fn()
const organization: Organization = {
	id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	slug: 'tessera',
	name: 'Tessera',
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
}

function mockMutation(overrides: Record<string, unknown> = {}) {
	useDeleteOrganizationMutationMock.mockReturnValue({
		mutate,
		reset,
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	} as never)
}

describe(OrganizationDeleteDialog.name, () => {
	beforeEach(() => {
		useNavigateMock.mockReturnValue(navigate)
		mockMutation()
	})

	test('enables deletion only after the exact handle is typed', async () => {
		const user = userEvent.setup()
		render(<OrganizationDeleteDialog organization={organization} />)
		await user.click(
			screen.getByRole('button', { name: 'Delete organization' })
		)
		const deleteButton = screen.getByRole<HTMLButtonElement>('button', {
			name: 'Delete forever',
		})

		expect(deleteButton.disabled).toBe(true)
		await user.type(screen.getByLabelText('Handle'), 'wrong')
		expect(deleteButton.disabled).toBe(true)
		await user.clear(screen.getByLabelText('Handle'))
		await user.type(screen.getByLabelText('Handle'), 'TESSERA')
		expect(deleteButton.disabled).toBe(false)
		await user.click(deleteButton)

		expect(mutate).toHaveBeenCalledWith(
			{ organizationId: organization.id, confirmationSlug: 'tessera' },
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
		mutate.mock.calls[0]?.[1].onSuccess()
		expect(navigate).toHaveBeenCalledWith({ to: '/profile' })
	})

	test('shows the repository guard and keeps the dialog open', async () => {
		const user = userEvent.setup()
		const { rerender } = render(
			<OrganizationDeleteDialog organization={organization} />
		)
		await user.click(
			screen.getByRole('button', { name: 'Delete organization' })
		)
		await user.type(screen.getByLabelText('Handle'), 'tessera')
		await user.click(screen.getByRole('button', { name: 'Delete forever' }))
		mockMutation({
			isError: true,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message:
					"Transfer or delete the organization's repositories before deleting it.",
			}),
		})
		rerender(<OrganizationDeleteDialog organization={organization} />)

		expect(screen.getByRole('dialog')).toBeTruthy()
		expect(screen.getByRole('alert').textContent).toContain(
			"Transfer or delete the organization's repositories before deleting it."
		)
		expect(screen.getByText('Delete Tessera?')).toBeTruthy()
	})
})
