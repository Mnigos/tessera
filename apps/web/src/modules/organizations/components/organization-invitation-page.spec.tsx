import { ORPCError } from '@orpc/client'
import type { MyOrganizationInvitation } from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { useNavigate } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { useAcceptOrganizationInvitationMutation } from '../hooks/use-accept-organization-invitation.mutation'
import { useDeclineOrganizationInvitationMutation } from '../hooks/use-decline-organization-invitation.mutation'
import { useMyOrganizationInvitationQuery } from '../hooks/use-my-organization-invitation.query'
import { OrganizationInvitationPage } from './organization-invitation-page'

vi.mock('@tanstack/react-router', () => ({ useNavigate: vi.fn() }))
vi.mock('@/modules/auth/hooks/use-auth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/use-accept-organization-invitation.mutation', () => ({
	useAcceptOrganizationInvitationMutation: vi.fn(),
}))
vi.mock('../hooks/use-decline-organization-invitation.mutation', () => ({
	useDeclineOrganizationInvitationMutation: vi.fn(),
}))
vi.mock('../hooks/use-my-organization-invitation.query', () => ({
	useMyOrganizationInvitationQuery: vi.fn(),
}))

const useNavigateMock = vi.mocked(useNavigate)
const useAuthMock = vi.mocked(useAuth)
const useAcceptOrganizationInvitationMutationMock = vi.mocked(
	useAcceptOrganizationInvitationMutation
)
const useDeclineOrganizationInvitationMutationMock = vi.mocked(
	useDeclineOrganizationInvitationMutation
)
const useMyOrganizationInvitationQueryMock = vi.mocked(
	useMyOrganizationInvitationQuery
)
const navigate = vi.fn()
const signIn = vi.fn()
const accept = vi.fn()
const decline = vi.fn()
const NOT_AVAILABLE_COPY_REGEX = /It may have been cancelled/
const invitationId =
	'00000000-0000-4000-8000-000000000030' as OrganizationInvitationId
const invitation: MyOrganizationInvitation = {
	id: invitationId,
	organizationId: '00000000-0000-4000-8000-000000000010' as OrganizationId,
	email: 'recipient@example.com',
	role: 'admin',
	status: 'pending',
	expiresAt: new Date(Date.now() + 86_400_000),
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: null,
		displayName: 'Owner Example',
	},
	organization: {
		id: '00000000-0000-4000-8000-000000000010' as OrganizationId,
		slug: 'tessera',
		name: 'Tessera',
	},
}

function mockSignedIn() {
	useAuthMock.mockReturnValue({
		isLoading: false,
		signIn,
		user: {
			id: '00000000-0000-4000-8000-000000000002' as UserId,
			username: 'recipient',
		},
	} as never)
}

function mockInvitationQuery(overrides: Record<string, unknown> = {}) {
	useMyOrganizationInvitationQueryMock.mockReturnValue({
		data: { invitation },
		isLoading: false,
		isError: false,
		error: null,
		...overrides,
	} as never)
}

function mockMutations() {
	useAcceptOrganizationInvitationMutationMock.mockReturnValue({
		mutate: accept,
		isPending: false,
		isError: false,
		isSuccess: false,
		error: null,
	} as never)
	useDeclineOrganizationInvitationMutationMock.mockReturnValue({
		mutate: decline,
		isPending: false,
		isError: false,
		isSuccess: false,
		error: null,
	} as never)
}

describe(OrganizationInvitationPage.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useNavigateMock.mockReturnValue(navigate)
		mockSignedIn()
		mockInvitationQuery()
		mockMutations()
	})

	test('offers sign-in with the invitation callback while signed out', async () => {
		useAuthMock.mockReturnValue({
			isLoading: false,
			signIn,
			user: undefined,
		} as never)
		const user = userEvent.setup()
		render(<OrganizationInvitationPage invitationId={invitationId} />)

		await user.click(screen.getByRole('button', { name: 'Sign in' }))
		expect(signIn).toHaveBeenCalledWith({
			callbackPath: `/invitations/${invitationId}`,
		})
		expect(useMyOrganizationInvitationQueryMock).not.toHaveBeenCalled()
	})

	test('rejects an invalid invitation id without querying', () => {
		render(<OrganizationInvitationPage invitationId="not-a-uuid" />)

		expect(
			screen.getByRole('heading', {
				name: 'This invitation link is not valid',
			})
		).toBeTruthy()
		expect(useMyOrganizationInvitationQueryMock).not.toHaveBeenCalled()
	})

	test('shows the not-available state for a missing invitation', () => {
		mockInvitationQuery({
			data: undefined,
			isError: true,
			error: new ORPCError('NOT_FOUND', { status: 404 }),
		})

		render(<OrganizationInvitationPage invitationId={invitationId} />)

		expect(
			screen.getByRole('heading', { name: 'This invitation is not available' })
		).toBeTruthy()
		expect(screen.getByText(NOT_AVAILABLE_COPY_REGEX)).toBeTruthy()
	})

	test('shows recipient mismatch copy', () => {
		useAcceptOrganizationInvitationMutationMock.mockReturnValue({
			mutate: accept,
			isPending: false,
			isError: true,
			isSuccess: false,
			error: new ORPCError('FORBIDDEN', {
				status: 403,
				message: 'This invitation was sent to a different email address.',
			}),
		} as never)

		render(<OrganizationInvitationPage invitationId={invitationId} />)

		expect(
			screen.getByText('This invitation was sent to a different email address.')
		).toBeTruthy()
	})

	test('shows the inviter display name when the username is missing', () => {
		render(<OrganizationInvitationPage invitationId={invitationId} />)

		expect(
			screen.getByText('Owner Example invited recipient@example.com', {
				exact: false,
			})
		).toBeTruthy()
	})

	test('accepts and navigates to the signed-in profile', async () => {
		const user = userEvent.setup()
		render(<OrganizationInvitationPage invitationId={invitationId} />)

		await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
		expect(accept).toHaveBeenCalledWith(
			{ invitationId },
			expect.objectContaining({ onSuccess: expect.any(Function) })
		)
		await accept.mock.calls[0]?.[1].onSuccess()
		expect(navigate).toHaveBeenCalledWith({
			to: '/profile/$username',
			params: { username: 'recipient' },
		})
	})

	test('declines an invitation', async () => {
		const user = userEvent.setup()
		render(<OrganizationInvitationPage invitationId={invitationId} />)

		await user.click(screen.getByRole('button', { name: 'Decline' }))
		expect(decline).toHaveBeenCalledWith({ invitationId })
	})

	test('shows the declined result', () => {
		useDeclineOrganizationInvitationMutationMock.mockReturnValue({
			mutate: decline,
			isPending: false,
			isError: false,
			isSuccess: true,
			error: null,
		} as never)

		render(<OrganizationInvitationPage invitationId={invitationId} />)

		expect(
			screen.getByRole('heading', { name: 'Invitation declined' })
		).toBeTruthy()
	})
})
