import { ORPCError } from '@orpc/client'
import type {
	CheckStatusProvider,
	CreatedCheckStatusCredential,
} from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCheckStatusProvidersQuery } from '../hooks/use-check-status-providers.query'
import { useCreateCheckStatusCredentialMutation } from '../hooks/use-create-check-status-credential.mutation'
import { useCreateCheckStatusProviderMutation } from '../hooks/use-create-check-status-provider.mutation'
import { useRevokeCheckStatusCredentialMutation } from '../hooks/use-revoke-check-status-credential.mutation'
import { CheckStatusProvidersSettings } from './check-status-providers-settings'

vi.mock('../hooks/use-check-status-providers.query', () => ({
	useCheckStatusProvidersQuery: vi.fn(),
}))

vi.mock('../hooks/use-create-check-status-provider.mutation', () => ({
	useCreateCheckStatusProviderMutation: vi.fn(),
}))

vi.mock('../hooks/use-create-check-status-credential.mutation', () => ({
	useCreateCheckStatusCredentialMutation: vi.fn(),
}))

vi.mock('../hooks/use-revoke-check-status-credential.mutation', () => ({
	useRevokeCheckStatusCredentialMutation: vi.fn(),
}))

const useProvidersQueryMock = vi.mocked(useCheckStatusProvidersQuery)
const useCreateProviderMock = vi.mocked(useCreateCheckStatusProviderMutation)
const useCreateCredentialMock = vi.mocked(
	useCreateCheckStatusCredentialMutation
)
const useRevokeCredentialMock = vi.mocked(
	useRevokeCheckStatusCredentialMutation
)

const CREATE_PROVIDER_REGEX = /Create provider/
const ISSUE_TOKEN_REGEX = /Issue token/
const ONLY_TIME_SHOWN_REGEX = /only time it is shown/
const NO_LIVE_TOKENS_REGEX = /No live tokens/

const PROPS = { username: 'marta', slug: 'notes' }
const CREDENTIAL = {
	id: '00000000-0000-4000-8000-000000000001',
	start: 'tes_status_abc',
	enabled: true,
	createdAt: new Date('2026-08-01T10:00:00Z'),
} as CheckStatusProvider['credentials'][number]
const PROVIDER = {
	id: '00000000-0000-4000-8000-000000000002',
	key: 'jenkins',
	displayName: 'Jenkins',
	credentials: [CREDENTIAL],
	createdAt: new Date('2026-08-01T10:00:00Z'),
	updatedAt: new Date('2026-08-01T10:00:00Z'),
} as CheckStatusProvider

function mockIdleMutation(overrides: object = {}) {
	return {
		mutate: vi.fn(),
		reset: vi.fn(),
		isPending: false,
		isError: false,
		error: null,
		variables: undefined,
		...overrides,
	} as never
}

function mockMutations(overrides: object = {}) {
	useCreateProviderMock.mockReturnValue(mockIdleMutation())
	useCreateCredentialMock.mockReturnValue(mockIdleMutation())
	useRevokeCredentialMock.mockReturnValue(mockIdleMutation(overrides))
}

function mockProviders(providers: CheckStatusProvider[]) {
	useProvidersQueryMock.mockReturnValue({
		data: { providers },
		error: null,
		isLoading: false,
		isError: false,
		isSuccess: true,
	} as never)
}

describe(CheckStatusProvidersSettings.name, () => {
	afterEach(() => vi.resetAllMocks())

	test('tells a non-admin why the page is empty rather than showing an error', () => {
		mockMutations()
		useProvidersQueryMock.mockReturnValue({
			data: undefined,
			error: new ORPCError('FORBIDDEN', { status: 403 }),
			isLoading: false,
			isError: true,
			isSuccess: false,
		} as never)

		render(<CheckStatusProvidersSettings {...PROPS} />)

		expect(screen.getByText('Admin access required')).toBeTruthy()
		expect(screen.queryByText('Add provider')).toBeNull()
	})

	test('says so plainly when nothing publishes here yet', () => {
		mockMutations()
		mockProviders([])

		render(<CheckStatusProvidersSettings {...PROPS} />)

		expect(screen.getByText('No status providers')).toBeTruthy()
	})

	test('creates a provider from the trimmed key and name', async () => {
		const mutate = vi.fn()
		mockMutations()
		useCreateProviderMock.mockReturnValue(mockIdleMutation({ mutate }))
		mockProviders([])

		render(<CheckStatusProvidersSettings {...PROPS} />)
		await userEvent.type(screen.getByLabelText('Key'), '  jenkins  ')
		await userEvent.type(screen.getByLabelText('Name'), '  Jenkins  ')
		submitProviderForm()

		expect(mutate).toHaveBeenCalledWith(
			{ ...PROPS, key: 'jenkins', displayName: 'Jenkins' },
			expect.anything()
		)
	})

	test('says why a whitespace-only submission was refused', async () => {
		const mutate = vi.fn()
		mockMutations()
		useCreateProviderMock.mockReturnValue(mockIdleMutation({ mutate }))
		mockProviders([])

		render(<CheckStatusProvidersSettings {...PROPS} />)
		await userEvent.type(screen.getByLabelText('Key'), '   ')
		submitProviderForm()

		expect(mutate).not.toHaveBeenCalled()
		expect(screen.getByRole('alert').textContent).toContain(
			'both a key and a name'
		)
	})

	test('shows the new secret once, and never renders a stored one', async () => {
		const created = {
			token: 'tes_status_raw-secret',
			credential: CREDENTIAL,
			provider: PROVIDER,
		} as CreatedCheckStatusCredential
		mockMutations()
		useCreateProviderMock.mockReturnValue(
			mockIdleMutation({
				mutate: (
					_input: unknown,
					options: { onSuccess: (v: unknown) => void }
				) => options.onSuccess(created),
			})
		)
		mockProviders([PROVIDER])

		render(<CheckStatusProvidersSettings {...PROPS} />)

		// Before creating, the listed credential shows only its visible prefix.
		expect(screen.queryByText('tes_status_raw-secret')).toBeNull()
		expect(screen.getByText('tes_status_abc…')).toBeTruthy()

		await userEvent.type(screen.getByLabelText('Key'), 'jenkins')
		await userEvent.type(screen.getByLabelText('Name'), 'Jenkins')
		submitProviderForm()

		expect(screen.getByText('tes_status_raw-secret')).toBeTruthy()
		expect(screen.getByText(ONLY_TIME_SHOWN_REGEX)).toBeTruthy()
	})

	test('rotates a provider by issuing another token against it', async () => {
		const mutate = vi.fn()
		mockMutations()
		useCreateCredentialMock.mockReturnValue(mockIdleMutation({ mutate }))
		mockProviders([PROVIDER])

		render(<CheckStatusProvidersSettings {...PROPS} />)
		await userEvent.click(
			screen.getByRole('button', { name: ISSUE_TOKEN_REGEX })
		)

		expect(mutate).toHaveBeenCalledWith(
			{ ...PROPS, providerId: PROVIDER.id },
			expect.anything()
		)
	})

	test('revokes the credential the admin pointed at', async () => {
		const mutate = vi.fn()
		mockMutations()
		useRevokeCredentialMock.mockReturnValue(mockIdleMutation({ mutate }))
		mockProviders([PROVIDER])

		render(<CheckStatusProvidersSettings {...PROPS} />)
		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

		expect(mutate).toHaveBeenCalledWith({
			...PROPS,
			credentialId: CREDENTIAL.id,
		})
	})

	test('warns that a provider with no live token cannot publish', () => {
		mockMutations()
		mockProviders([
			{
				...PROVIDER,
				credentials: [{ ...CREDENTIAL, revokedAt: new Date() }],
			},
		])

		render(<CheckStatusProvidersSettings {...PROPS} />)

		expect(screen.getByText(NO_LIVE_TOKENS_REGEX)).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
	})

	test('hides a credential that has expired on its own', () => {
		mockMutations()
		mockProviders([
			{
				...PROVIDER,
				credentials: [
					{ ...CREDENTIAL, expiresAt: new Date('2020-01-01T00:00:00Z') },
				],
			},
		])

		render(<CheckStatusProvidersSettings {...PROPS} />)

		expect(screen.getByText(NO_LIVE_TOKENS_REGEX)).toBeTruthy()
	})
})

/**
 * Base UI buttons do not raise an implicit submit in jsdom, so the form is
 * submitted directly — the same way the branch-protection settings are tested.
 */
function submitProviderForm() {
	const form = screen
		.getByRole('button', { name: CREATE_PROVIDER_REGEX })
		.closest('form')

	if (!form) throw new Error('provider form is not rendered')

	fireEvent.submit(form)
}
