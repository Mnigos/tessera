import type { Organization } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { Card } from '@repo/ui/components/card'
import { useOrganizationMembersQuery } from '../hooks/use-organization-members.query'
import { OrganizationMembersList } from './organization-members-list'

interface OrganizationMembersPanelProps {
	organizationId: Organization['id']
	organizationName: string
	viewerRole: OrganizationRole
}

export function OrganizationMembersPanel({
	organizationId,
	organizationName,
	viewerRole,
}: Readonly<OrganizationMembersPanelProps>) {
	const membersQuery = useOrganizationMembersQuery({ organizationId })

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">Members</h2>
				<p className="text-muted-foreground text-sm">
					{viewerRole === 'member'
						? 'Owners and admins manage who belongs to this organization.'
						: 'Owners and admins manage roles; only owners can grant or remove the owner role.'}
				</p>
			</div>
			<OrganizationMembersList
				isError={membersQuery.isError}
				isLoading={membersQuery.isLoading}
				members={membersQuery.data?.members}
				organizationId={organizationId}
				organizationName={organizationName}
				viewerRole={membersQuery.data?.viewerRole ?? viewerRole}
			/>
		</Card>
	)
}
