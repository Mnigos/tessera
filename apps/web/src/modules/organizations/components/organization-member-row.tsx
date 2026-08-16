import type { Organization, OrganizationMember } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { getOrganizationMemberName } from '../helpers/get-organization-member-name'
import type { OrganizationMemberPermissions } from '../helpers/get-organization-member-permissions'
import { useUpdateOrganizationMemberRoleMutation } from '../hooks/use-update-organization-member-role.mutation'
import { LeaveOrganizationDialog } from './leave-organization-dialog'
import { OrganizationRoleSelect } from './organization-role-select'
import { RemoveOrganizationMemberDialog } from './remove-organization-member-dialog'

interface OrganizationMemberRowProps {
	member: OrganizationMember
	organizationId: Organization['id']
	organizationName: string
	permissions: OrganizationMemberPermissions
	viewerRole: OrganizationRole
}

export function OrganizationMemberRow({
	member,
	organizationId,
	organizationName,
	permissions,
	viewerRole,
}: Readonly<OrganizationMemberRowProps>) {
	const updateRole = useUpdateOrganizationMemberRoleMutation()
	const memberName = getOrganizationMemberName(member.user)

	function handleRoleChange(role: OrganizationRole) {
		if (role === member.role) return

		updateRole.mutate({ organizationId, memberId: member.id, role })
	}

	return (
		<li className="flex flex-col gap-2 px-4 py-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					{member.user.avatarUrl ? (
						<img
							alt=""
							className="size-8 shrink-0 rounded-md"
							height="32"
							src={member.user.avatarUrl}
							width="32"
						/>
					) : (
						<div className="size-8 shrink-0 rounded-md bg-secondary" />
					)}
					<div className="min-w-0">
						<p className="truncate font-medium text-sm">
							{memberName}
							{permissions.isViewer && (
								<span className="ml-2 text-muted-foreground text-xs">You</span>
							)}
						</p>
						{member.user.username && (
							<p className="truncate text-muted-foreground text-xs">
								{member.user.displayName}
							</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<OrganizationRoleSelect
						ariaLabel={`Change role for ${memberName}`}
						canAssignOwner={viewerRole === 'owner'}
						disabled={!permissions.canChangeRole || updateRole.isPending}
						onRoleChange={handleRoleChange}
						role={member.role}
					/>
					{permissions.canLeave && (
						<LeaveOrganizationDialog
							organizationId={organizationId}
							organizationName={organizationName}
						/>
					)}
					{permissions.canRemove && (
						<RemoveOrganizationMemberDialog
							member={member}
							organizationId={organizationId}
							organizationName={organizationName}
						/>
					)}
				</div>
			</div>
			{permissions.restriction && (
				<p className="text-muted-foreground text-xs">
					{permissions.restriction}
				</p>
			)}
			{updateRole.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getOrganizationErrorMessage(
						updateRole.error,
						'Role could not be changed.'
					)}
				</p>
			)}
		</li>
	)
}
