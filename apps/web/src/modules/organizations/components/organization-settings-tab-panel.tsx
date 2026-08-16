import type { Organization } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { OrganizationDeleteDialog } from './organization-delete-dialog'
import { OrganizationInvitationsPanel } from './organization-invitations-panel'
import { OrganizationMembersPanel } from './organization-members-panel'
import { OrganizationSettingsForm } from './organization-settings-form'
import type { OrganizationSettingsTab } from './organization-settings-navigation'

interface OrganizationSettingsTabPanelProps {
	organization: Organization
	tab: OrganizationSettingsTab
	viewerRole: OrganizationRole
}

export function OrganizationSettingsTabPanel({
	organization,
	tab,
	viewerRole,
}: Readonly<OrganizationSettingsTabPanelProps>) {
	if (tab === 'members')
		return (
			<OrganizationMembersPanel
				organizationId={organization.id}
				organizationName={organization.name}
				viewerRole={viewerRole}
			/>
		)

	if (tab === 'invitations')
		return (
			<OrganizationInvitationsPanel
				organizationId={organization.id}
				viewerRole={viewerRole}
			/>
		)

	return (
		<div className="flex flex-col gap-6">
			{/* Remount on rename */}
			<OrganizationSettingsForm
				canRename={viewerRole !== 'member'}
				key={organization.slug}
				organization={organization}
			/>
			{viewerRole === 'owner' && (
				<OrganizationDeleteDialog organization={organization} />
			)}
		</div>
	)
}
