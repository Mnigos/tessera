import type { Organization } from '@repo/contracts'
import type { OrganizationId } from '@repo/domain'
import { useNavigate } from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUpdateOrganizationMutation } from '../hooks/use-update-organization.mutation'
import { OrganizationSettingsForm } from './organization-settings-form'

vi.mock('@tanstack/react-router', () => ({ useNavigate: vi.fn() }))
vi.mock('../hooks/use-update-organization.mutation', () => ({
	useUpdateOrganizationMutation: vi.fn(),
}))

const useNavigateMock = vi.mocked(useNavigate)
const useUpdateOrganizationMutationMock = vi.mocked(
	useUpdateOrganizationMutation
)
const navigate = vi.fn()
const mutate = vi.fn()
const CLONE_URL_WARNING_REGEX =
	/Renaming changes clone URLs for all repositories/
const organization: Organization = {
	id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	slug: 'tessera',
	name: 'Tessera',
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
}

describe(OrganizationSettingsForm.name, () => {
	beforeEach(() => {
		useNavigateMock.mockReturnValue(navigate)
		useUpdateOrganizationMutationMock.mockReturnValue({
			mutate,
			isPending: false,
			isError: false,
			error: null,
		} as never)
	})

	test('renames an organization, warns about clone URLs, and follows the new slug', async () => {
		const user = userEvent.setup()
		render(<OrganizationSettingsForm canRename organization={organization} />)

		await user.clear(screen.getByLabelText('Handle'))
		await user.type(screen.getByLabelText('Handle'), 'tessera-next')
		expect(screen.getByText(CLONE_URL_WARNING_REGEX)).toBeTruthy()
		const submitButton = screen.getByRole('button', { name: 'Save changes' })
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)

		expect(mutate).toHaveBeenCalledWith(
			{
				organizationId: organization.id,
				name: 'Tessera',
				slug: 'tessera-next',
			},
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
		mutate.mock.calls[0]?.[1].onSuccess({
			organization: { ...organization, slug: 'tessera-next' },
		})
		expect(navigate).toHaveBeenCalledWith({
			to: '/organizations/$slug/settings',
			params: { slug: 'tessera-next' },
			replace: true,
		})
	})

	test('disables settings for a member', () => {
		render(
			<OrganizationSettingsForm canRename={false} organization={organization} />
		)

		const fieldset = screen.getByLabelText('Name').closest('fieldset')

		expect(fieldset).toBeTruthy()
		if (!fieldset) return

		expect(fieldset.disabled).toBe(true)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })
				.disabled
		).toBe(true)
	})
})
