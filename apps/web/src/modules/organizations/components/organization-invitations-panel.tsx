import type { Organization } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { Card } from '@repo/ui/components/card'
import { useOrganizationInvitationsQuery } from '../hooks/use-organization-invitations.query'
import { OrganizationInvitationsList } from './organization-invitations-list'
import { OrganizationInviteForm } from './organization-invite-form'

interface OrganizationInvitationsPanelProps {
	organizationId: Organization['id']
	viewerRole: OrganizationRole
}

export function OrganizationInvitationsPanel({
	organizationId,
	viewerRole,
}: Readonly<OrganizationInvitationsPanelProps>) {
	const canManageInvitations = viewerRole !== 'member'
	const invitationsQuery = useOrganizationInvitationsQuery(
		{ organizationId },
		canManageInvitations
	)

	if (!canManageInvitations)
		return (
			<Card className="border-dashed p-6 text-muted-foreground text-sm">
				Only owners and admins can see this organization's invitations.
			</Card>
		)

	return (
		<div className="flex flex-col gap-6">
			<OrganizationInviteForm
				organizationId={organizationId}
				viewerRole={viewerRole}
			/>
			<div className="flex flex-col gap-3">
				<h2 className="font-semibold text-lg tracking-normal">
					Pending invitations
				</h2>
				<OrganizationInvitationsList
					invitations={invitationsQuery.data?.invitations}
					isError={invitationsQuery.isError}
					isLoading={invitationsQuery.isLoading}
					organizationId={organizationId}
				/>
			</div>
		</div>
	)
}
