import { ORPCError } from '@orpc/client'
import { repositoryCollaboratorSchema } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAddRepositoryCollaboratorMutation } from '../hooks/use-add-repository-collaborator.mutation'
import { useRemoveRepositoryCollaboratorMutation } from '../hooks/use-remove-repository-collaborator.mutation'
import { useRepositoryCollaboratorsQuery } from '../hooks/use-repository-collaborators.query'
import { useUpdateRepositoryCollaboratorRoleMutation } from '../hooks/use-update-repository-collaborator-role.mutation'
import { RepositoryCollaboratorsSettings } from './repository-collaborators-settings'

vi.mock('../hooks/use-repository-collaborators.query', () => ({
	useRepositoryCollaboratorsQuery: vi.fn(),
}))

vi.mock('../hooks/use-add-repository-collaborator.mutation', () => ({
	useAddRepositoryCollaboratorMutation: vi.fn(),
}))

vi.mock('../hooks/use-update-repository-collaborator-role.mutation', () => ({
	useUpdateRepositoryCollaboratorRoleMutation: vi.fn(),
}))

vi.mock('../hooks/use-remove-repository-collaborator.mutation', () => ({
	useRemoveRepositoryCollaboratorMutation: vi.fn(),
}))

const useRepositoryCollaboratorsQueryMock = vi.mocked(
	useRepositoryCollaboratorsQuery
)
const useAddRepositoryCollaboratorMutationMock = vi.mocked(
	useAddRepositoryCollaboratorMutation
)
const useUpdateRepositoryCollaboratorRoleMutationMock = vi.mocked(
	useUpdateRepositoryCollaboratorRoleMutation
)
const useRemoveRepositoryCollaboratorMutationMock = vi.mocked(
	useRemoveRepositoryCollaboratorMutation
)

const COLLABORATOR = repositoryCollaboratorSchema.parse({
	userId: 'd8101d74-b320-4482-a8f2-a25308fb2757',
	username: 'anna',
	role: 'read',
	createdAt: new Date('2026-07-11T10:00:00.000Z'),
})

function mockIdleMutation() {
	return {
		mutate: vi.fn(),
		reset: vi.fn(),
		isPending: false,
		isError: false,
		error: null,
	} as never
}

function mockMutations() {
	useAddRepositoryCollaboratorMutationMock.mockReturnValue(mockIdleMutation())
	useUpdateRepositoryCollaboratorRoleMutationMock.mockReturnValue(
		mockIdleMutation()
	)
	useRemoveRepositoryCollaboratorMutationMock.mockReturnValue(
		mockIdleMutation()
	)
}

describe(RepositoryCollaboratorsSettings.name, () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('renders loading, error, forbidden, and empty states', () => {
		mockMutations()
		useRepositoryCollaboratorsQueryMock.mockReturnValue({
			data: undefined,
			error: null,
			isLoading: true,
			isError: false,
		} as never)
		const props = { username: 'marta', slug: 'notes' }
		const { rerender } = render(<RepositoryCollaboratorsSettings {...props} />)
		expect(document.querySelector('.animate-pulse')).toBeTruthy()

		useRepositoryCollaboratorsQueryMock.mockReturnValue({
			data: undefined,
			error: new Error('boom'),
			isLoading: false,
			isError: true,
		} as never)
		rerender(<RepositoryCollaboratorsSettings {...props} />)
		expect(screen.getByText('Collaborators could not be loaded')).toBeTruthy()

		useRepositoryCollaboratorsQueryMock.mockReturnValue({
			data: undefined,
			error: new ORPCError('FORBIDDEN', { status: 403 }),
			isLoading: false,
			isError: true,
		} as never)
		rerender(<RepositoryCollaboratorsSettings {...props} />)
		expect(screen.getByText('Admin access required')).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: 'Add collaborator' })
		).toBeNull()

		useRepositoryCollaboratorsQueryMock.mockReturnValue({
			data: { collaborators: [] },
			error: null,
			isLoading: false,
			isError: false,
		} as never)
		rerender(<RepositoryCollaboratorsSettings {...props} />)
		expect(screen.getByText('No collaborators yet.')).toBeTruthy()
	})

	test('renders collaborator rows and submits the add form with the default role', async () => {
		mockMutations()
		const addCollaborator = mockIdleMutation() as {
			mutate: ReturnType<typeof vi.fn>
		}
		useAddRepositoryCollaboratorMutationMock.mockReturnValue(
			addCollaborator as never
		)
		useRepositoryCollaboratorsQueryMock.mockReturnValue({
			data: { collaborators: [COLLABORATOR] },
			error: null,
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()
		render(<RepositoryCollaboratorsSettings slug="notes" username="marta" />)

		expect(screen.getByText('anna')).toBeTruthy()
		expect(screen.getByText('Added Jul 11, 2026')).toBeTruthy()
		expect(screen.getByLabelText('Change role for anna')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Remove anna' })).toBeTruthy()

		await user.type(screen.getByLabelText('Username'), 'igor')
		const submitButton = screen.getByRole('button', {
			name: 'Add collaborator',
		})
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)
		expect(addCollaborator.mutate.mock.calls[0]?.[0]).toEqual({
			username: 'marta',
			slug: 'notes',
			collaboratorUsername: 'igor',
			role: 'write',
		})
	})
})
