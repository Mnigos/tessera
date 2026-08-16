import type { Organization } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { useOrganizationQuery } from '../hooks/use-organization.query'
import { OrganizationDeleteDialog } from './organization-delete-dialog'
import { OrganizationSettingsForm } from './organization-settings-form'
import { OrganizationSettingsNavigation } from './organization-settings-navigation'

interface OrganizationSettingsPanelProps {
	organizationId: Organization['id']
}

export function OrganizationSettingsPanel({
	organizationId,
}: Readonly<OrganizationSettingsPanelProps>) {
	const organizationQuery = useOrganizationQuery({ organizationId })

	if (organizationQuery.isLoading)
		return (
			<section className="flex flex-col gap-4">
				<div className="h-10 animate-pulse rounded-md bg-secondary/60" />
				<div className="h-64 animate-pulse rounded-md bg-secondary/40" />
			</section>
		)

	if (!organizationQuery.data)
		return (
			<Card className="border-dashed p-6 text-muted-foreground text-sm">
				Organization settings could not be loaded.
			</Card>
		)

	const { organization, viewerRole } = organizationQuery.data

	return (
		<section className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					/{organization.slug}
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">
					{organization.name}
				</h1>
			</header>
			<OrganizationSettingsNavigation slug={organization.slug} tab="general" />
			<div className="flex flex-col gap-6">
				{/* Keyed by handle: after a rename the form starts again from what
				    was saved, rather than holding the value that was typed. */}
				<OrganizationSettingsForm
					canRename={viewerRole !== 'member'}
					key={organization.slug}
					organization={organization}
				/>
				{viewerRole === 'owner' && (
					<OrganizationDeleteDialog organization={organization} />
				)}
			</div>
		</section>
	)
}
