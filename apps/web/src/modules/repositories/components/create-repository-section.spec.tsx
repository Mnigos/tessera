import type { OrganizationId } from '@repo/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useOrganizationsQuery } from '@/modules/organizations/hooks/use-organizations.query'
import { useCreateRepositoryMutation } from '../hooks/use-create-repository.mutation'
import { CreateRepositorySection } from './create-repository-section'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		to: string
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))
vi.mock('@/modules/organizations/hooks/use-organizations.query', () => ({
	useOrganizationsQuery: vi.fn(),
}))
vi.mock('../hooks/use-create-repository.mutation', () => ({
	useCreateRepositoryMutation: vi.fn(),
}))

const useOrganizationsQueryMock = vi.mocked(useOrganizationsQuery)
const useCreateRepositoryMutationMock = vi.mocked(useCreateRepositoryMutation)
const mutate = vi.fn()
const ORGANIZATIONS_ERROR_REGEX = /Organizations could not be loaded/

function mockOrganizations({
	isError = false,
	isLoading = false,
	organizations = [],
}: {
	isError?: boolean
	isLoading?: boolean
	organizations?: {
		id: OrganizationId
		slug: string
		name: string
		role: 'owner' | 'admin' | 'member'
	}[]
} = {}) {
	useOrganizationsQueryMock.mockReturnValue({
		data: { organizations },
		isError,
		isLoading,
	} as never)
}

function mockCreateMutation(overrides: Record<string, unknown> = {}) {
	useCreateRepositoryMutationMock.mockReturnValue({
		mutate,
		isError: false,
		isPending: false,
		isSuccess: false,
		data: undefined,
		...overrides,
	} as never)
}

function submitRepository(name = 'Notes') {
	fireEvent.change(screen.getByLabelText('Name'), {
		target: { value: name },
	})
	const form = screen
		.getByRole('button', { name: 'Create repository' })
		.closest('form')

	if (!form) throw new Error('repository form was not rendered')

	fireEvent.submit(form)
}

describe(CreateRepositorySection.name, () => {
	beforeEach(() => {
		mockOrganizations()
		mockCreateMutation()
	})

	test('offers only organizations the viewer owns or administers', async () => {
		const user = userEvent.setup()
		mockOrganizations({
			organizations: [
				{
					id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
					slug: 'owned',
					name: 'Owned',
					role: 'owner',
				},
				{
					id: '00000000-0000-4000-8000-000000000011' as OrganizationId,
					slug: 'administered',
					name: 'Administered',
					role: 'admin',
				},
				{
					id: '00000000-0000-4000-8000-000000000012' as OrganizationId,
					slug: 'member-only',
					name: 'Member only',
					role: 'member',
				},
			],
		})

		render(<CreateRepositorySection username="marta" />)
		await user.click(screen.getByRole('combobox', { name: 'Owner' }))

		expect(screen.getByRole('option', { name: '@marta' })).toBeTruthy()
		expect(screen.getByRole('option', { name: '@owned' })).toBeTruthy()
		expect(screen.getByRole('option', { name: '@administered' })).toBeTruthy()
		expect(screen.queryByRole('option', { name: '@member-only' })).toBeFalsy()
	})

	test('hides owner selection when no administrable organizations exist', () => {
		mockOrganizations({
			organizations: [
				{
					id: '00000000-0000-4000-8000-000000000012' as OrganizationId,
					slug: 'member-only',
					name: 'Member only',
					role: 'member',
				},
			],
		})

		render(<CreateRepositorySection username="marta" />)

		expect(screen.queryByRole('combobox', { name: 'Owner' })).toBeFalsy()
	})

	test('disables submission while owner options load', () => {
		mockOrganizations({ isLoading: true })

		render(<CreateRepositorySection username="marta" />)

		expect(
			screen
				.getByRole('button', { name: 'Create repository' })
				.hasAttribute('disabled')
		).toBeTruthy()
	})

	test('keeps personal ownership when organization loading fails', () => {
		mockOrganizations({ isError: true })

		render(<CreateRepositorySection username="marta" />)
		submitRepository()

		expect(screen.getByText(ORGANIZATIONS_ERROR_REGEX)).toBeTruthy()
		expect(mutate).toHaveBeenCalledWith({
			name: 'Notes',
			slug: undefined,
			description: undefined,
			visibility: 'private',
			owner: { kind: 'user' },
		})
	})

	test('submits the selected organization owner', async () => {
		const user = userEvent.setup()
		const organizationId =
			'00000000-0000-4000-8000-000000000010' as OrganizationId
		mockOrganizations({
			organizations: [
				{
					id: organizationId,
					slug: 'tessera',
					name: 'Tessera',
					role: 'admin',
				},
			],
		})

		render(<CreateRepositorySection username="marta" />)
		await user.click(screen.getByRole('combobox', { name: 'Owner' }))
		await user.click(screen.getByRole('option', { name: '@tessera' }))
		submitRepository('Organization Notes')

		expect(mutate).toHaveBeenCalledWith({
			name: 'Organization Notes',
			slug: undefined,
			description: undefined,
			visibility: 'private',
			owner: { kind: 'organization', organizationId },
		})
	})

	test('reports successful creation under the returned owner handle', () => {
		mockCreateMutation({
			isSuccess: true,
			data: {
				repository: { slug: 'notes' },
				owner: {
					kind: 'organization',
					handle: 'tessera',
					username: 'tessera',
				},
			},
		})

		render(<CreateRepositorySection username="marta" />)

		expect(screen.getByText('Created @tessera/notes.')).toBeTruthy()
	})
})
