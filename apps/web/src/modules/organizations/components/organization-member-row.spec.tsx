import { ORPCError } from '@orpc/client'
import type { OrganizationMember } from '@repo/contracts'
import type { OrganizationId, OrganizationMemberId, UserId } from '@repo/domain'
import { render, screen } from '@testing-library/react'
import { useUpdateOrganizationMemberRoleMutation } from '../hooks/use-update-organization-member-role.mutation'
import { OrganizationMemberRow } from './organization-member-row'

vi.mock('../hooks/use-update-organization-member-role.mutation', () => ({
	useUpdateOrganizationMemberRoleMutation: vi.fn(),
}))
vi.mock('./leave-organization-dialog', () => ({
	LeaveOrganizationDialog: () => <button type="button">Leave</button>,
}))
vi.mock('./remove-organization-member-dialog', () => ({
	RemoveOrganizationMemberDialog: () => <button type="button">Remove</button>,
}))

const useUpdateOrganizationMemberRoleMutationMock = vi.mocked(
	useUpdateOrganizationMemberRoleMutation
)
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const member: OrganizationMember = {
	id: '00000000-0000-4000-8000-000000000020' as OrganizationMemberId,
	role: 'member',
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	user: {
		id: '00000000-0000-4000-8000-000000000002' as UserId,
		username: null,
		displayName: 'Anna Example',
	},
}

describe(OrganizationMemberRow.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useUpdateOrganizationMemberRoleMutationMock.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
		} as never)
	})

	test('renders a nullable-username member and the supplied restriction', () => {
		render(
			<OrganizationMemberRow
				member={member}
				organizationId={organizationId}
				organizationName="Tessera"
				permissions={{
					isViewer: false,
					canChangeRole: false,
					canRemove: false,
					canLeave: false,
					restriction: 'Only owners can manage owners.',
				}}
				viewerRole="admin"
			/>
		)

		expect(screen.getByText('Anna Example')).toBeTruthy()
		expect(screen.getByText('Only owners can manage owners.')).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('combobox', {
				name: 'Change role for Anna Example',
			}).disabled
		).toBe(true)
	})

	test('keeps role controls disabled and shows API copy while pending fails', () => {
		useUpdateOrganizationMemberRoleMutationMock.mockReturnValue({
			mutate: vi.fn(),
			isPending: true,
			isError: true,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: 'An organization needs at least one owner.',
			}),
		} as never)

		render(
			<OrganizationMemberRow
				member={member}
				organizationId={organizationId}
				organizationName="Tessera"
				permissions={{
					isViewer: false,
					canChangeRole: true,
					canRemove: true,
					canLeave: false,
				}}
				viewerRole="owner"
			/>
		)

		expect(
			screen.getByRole<HTMLButtonElement>('combobox', {
				name: 'Change role for Anna Example',
			}).disabled
		).toBe(true)
		expect(screen.getByRole('alert').textContent).toContain(
			'An organization needs at least one owner.'
		)
	})
})
