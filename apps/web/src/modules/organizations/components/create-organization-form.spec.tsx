import { ORPCError } from '@orpc/client'
import type { OrganizationId } from '@repo/domain'
import { useNavigate } from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCreateOrganizationMutation } from '../hooks/use-create-organization.mutation'
import { CreateOrganizationForm } from './create-organization-form'

vi.mock('@tanstack/react-router', () => ({ useNavigate: vi.fn() }))
vi.mock('../hooks/use-create-organization.mutation', () => ({
	useCreateOrganizationMutation: vi.fn(),
}))

const useNavigateMock = vi.mocked(useNavigate)
const useCreateOrganizationMutationMock = vi.mocked(
	useCreateOrganizationMutation
)
const navigate = vi.fn()
const mutate = vi.fn()

function mockMutation(overrides: Record<string, unknown> = {}) {
	useCreateOrganizationMutationMock.mockReturnValue({
		mutate,
		isPending: false,
		isError: false,
		error: null,
		...overrides,
	} as never)
}

describe(CreateOrganizationForm.name, () => {
	beforeEach(() => {
		useNavigateMock.mockReturnValue(navigate)
		mockMutation()
	})

	test('creates an organization and opens its settings', async () => {
		const user = userEvent.setup()
		render(<CreateOrganizationForm />)

		await user.type(screen.getByLabelText('Name'), 'Tessera HQ')
		expect(screen.getByLabelText<HTMLInputElement>('Handle').value).toBe(
			'tessera-hq'
		)
		const submitButton = screen.getByRole('button', {
			name: 'Create organization',
		})
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)

		expect(mutate).toHaveBeenCalledWith(
			{ name: 'Tessera HQ', slug: 'tessera-hq' },
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
		mutate.mock.calls[0]?.[1].onSuccess({
			organization: {
				id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
				slug: 'tessera-hq',
				name: 'Tessera HQ',
				createdAt: new Date('2026-08-16T10:00:00.000Z'),
			},
		})
		expect(navigate).toHaveBeenCalledWith({
			to: '/organizations/$slug/settings',
			params: { slug: 'tessera-hq' },
		})
	})

	test.each([
		[409, 'This handle is already taken by a user or organization.'],
		[
			409,
			'TesseraHQ is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.',
		],
		[
			503,
			"GitHub availability for this handle couldn't be verified. Try again in a moment.",
		],
	] as const)('shows the API error copy for status %s', (status, message) => {
		mockMutation({
			isError: true,
			error: new ORPCError(
				status === 503 ? 'SERVICE_UNAVAILABLE' : 'CONFLICT',
				{
					status,
					message,
				}
			),
		})

		render(<CreateOrganizationForm />)

		expect(screen.getByRole('alert').textContent).toContain(message)
	})

	test('shows local validation copy without calling the mutation', async () => {
		const user = userEvent.setup()
		render(<CreateOrganizationForm />)
		await user.type(screen.getByLabelText('Name'), 'Tessera')
		await user.clear(screen.getByLabelText('Handle'))
		await user.type(screen.getByLabelText('Handle'), '-invalid')
		const submitButton = screen.getByRole('button', {
			name: 'Create organization',
		})
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)
		expect(screen.getByRole('alert').textContent).toContain(
			'Handle may use lowercase letters, numbers, and single dashes between them.'
		)
		expect(mutate).not.toHaveBeenCalled()
	})
})
