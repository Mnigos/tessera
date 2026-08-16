import { Card } from '@repo/ui/components/card'
import { findOrganizationMembership } from '../helpers/find-organization-membership'
import { useOrganizationsQuery } from '../hooks/use-organizations.query'
import { OrganizationSettingsPanel } from './organization-settings-panel'

interface OrganizationSettingsProps {
	slug: string
}

/**
 * The URL names an organization by handle and the API answers by id, so the
 * viewer's own membership list is what resolves one to the other. A handle that
 * is not in it gets the same answer as a handle that does not exist: membership
 * of an organization is not something a stranger gets to confirm.
 */
export function OrganizationSettings({
	slug,
}: Readonly<OrganizationSettingsProps>) {
	const organizationsQuery = useOrganizationsQuery()
	const membership = findOrganizationMembership(
		organizationsQuery.data?.organizations,
		slug
	)

	if (organizationsQuery.isLoading)
		return (
			<section className="flex flex-col gap-4">
				<div className="h-10 animate-pulse rounded-md bg-secondary/60" />
				<div className="h-64 animate-pulse rounded-md bg-secondary/40" />
			</section>
		)

	if (!membership)
		return (
			<Card className="border-dashed p-6 text-muted-foreground text-sm">
				This organization does not exist, or you are not a member of it.
			</Card>
		)

	return (
		<OrganizationSettingsPanel
			key={membership.id}
			organizationId={membership.id}
		/>
	)
}
