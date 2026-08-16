import type { OrganizationMember } from '@repo/contracts'
import type {
	OrganizationId,
	OrganizationMemberId,
	OrganizationRole,
	UserId,
} from '@repo/domain'
import { render, screen } from '@testing-library/react'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { useUpdateOrganizationMemberRoleMutation } from '../hooks/use-update-organization-member-role.mutation'
import { OrganizationMembersList } from './organization-members-list'

vi.mock('@/modules/auth/hooks/use-auth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/use-update-organization-member-role.mutation', () => ({
	useUpdateOrganizationMemberRoleMutation: vi.fn(),
}))
vi.mock('./leave-organization-dialog', () => ({
	LeaveOrganizationDialog: () => <button type="button">Leave</button>,
}))
vi.mock('./remove-organization-member-dialog', () => ({
	RemoveOrganizationMemberDialog: ({
		member,
	}: {
		member: OrganizationMember
	}) => <button type="button">Remove {member.user.username}</button>,
}))

const useAuthMock = vi.mocked(useAuth)
const useUpdateOrganizationMemberRoleMutationMock = vi.mocked(
	useUpdateOrganizationMemberRoleMutation
)
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const viewerUserId = '00000000-0000-4000-8000-000000000001' as UserId

function createMember(
	username: string,
	role: OrganizationRole,
	userId: UserId
): OrganizationMember {
	return {
		id: crypto.randomUUID() as OrganizationMemberId,
		role,
		createdAt: new Date('2026-08-16T10:00:00.000Z'),
		user: { id: userId, username, displayName: username },
	}
}

function renderList(
	members: OrganizationMember[],
	viewerRole: OrganizationRole
) {
	return render(
		<OrganizationMembersList
			isError={false}
			isLoading={false}
			members={members}
			organizationId={organizationId}
			organizationName="Tessera"
			viewerRole={viewerRole}
		/>
	)
}

describe(OrganizationMembersList.name, () => {
	beforeEach(() => {
		vi.clearAllMocks()
		useAuthMock.mockReturnValue({ user: { id: viewerUserId } } as never)
		useUpdateOrganizationMemberRoleMutationMock.mockReturnValue({
			mutate: vi.fn(),
			isPending: false,
			isError: false,
			error: null,
		} as never)
	})

	test('disables actions for the last owner', () => {
		renderList([createMember('owner', 'owner', viewerUserId)], 'owner')

		expect(
			screen.getByRole<HTMLButtonElement>('combobox', {
				name: 'Change role for owner',
			}).disabled
		).toBe(true)
		expect(
			screen.getByText('An organization needs at least one owner.')
		).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
	})

	test('disables owner management for an admin', () => {
		const secondOwnerId = '00000000-0000-4000-8000-000000000003' as UserId
		const adminId = viewerUserId
		renderList(
			[
				createMember('first-owner', 'owner', secondOwnerId),
				createMember(
					'second-owner',
					'owner',
					'00000000-0000-4000-8000-000000000004' as UserId
				),
				createMember('admin', 'admin', adminId),
			],
			'admin'
		)

		expect(
			screen.getByRole<HTMLButtonElement>('combobox', {
				name: 'Change role for first-owner',
			}).disabled
		).toBe(true)
		expect(screen.getAllByText('Only owners can manage owners.')).toHaveLength(
			2
		)
		expect(
			screen.queryByRole('button', { name: 'Remove first-owner' })
		).toBeNull()
	})

	test('disables management actions for a member viewer', () => {
		renderList(
			[
				createMember('viewer', 'member', viewerUserId),
				createMember(
					'other-member',
					'member',
					'00000000-0000-4000-8000-000000000002' as UserId
				),
			],
			'member'
		)

		expect(
			screen.getByRole<HTMLButtonElement>('combobox', {
				name: 'Change role for other-member',
			}).disabled
		).toBe(true)
		expect(
			screen.queryByRole('button', { name: 'Remove other-member' })
		).toBeNull()
	})

	test('shows Leave only for the viewer row', () => {
		renderList(
			[
				createMember('viewer', 'admin', viewerUserId),
				createMember(
					'other-member',
					'member',
					'00000000-0000-4000-8000-000000000002' as UserId
				),
			],
			'admin'
		)

		expect(screen.getAllByRole('button', { name: 'Leave' })).toHaveLength(1)
		expect(screen.getByText('You')).toBeTruthy()
	})

	test('shows loading and error states', () => {
		const props = {
			members: undefined,
			organizationId,
			organizationName: 'Tessera',
			viewerRole: 'owner' as const,
		}
		const { rerender } = render(
			<OrganizationMembersList {...props} isError={false} isLoading />
		)

		expect(document.querySelectorAll('.animate-pulse')).toHaveLength(9)
		rerender(<OrganizationMembersList {...props} isError isLoading={false} />)
		expect(screen.getByText('Members could not be loaded.')).toBeTruthy()
	})
})
