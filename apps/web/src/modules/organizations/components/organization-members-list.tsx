import type { Organization, OrganizationMember } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'
import { Card } from '@repo/ui/components/card'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import {
	countOrganizationOwners,
	getOrganizationMemberPermissions,
} from '../helpers/get-organization-member-permissions'
import { OrganizationMemberRow } from './organization-member-row'

interface OrganizationMembersListProps {
	members: OrganizationMember[] | undefined
	organizationId: Organization['id']
	organizationName: string
	viewerRole: OrganizationRole
	isError: boolean
	isLoading: boolean
}

export function OrganizationMembersList({
	isError,
	isLoading,
	members,
	organizationId,
	organizationName,
	viewerRole,
}: Readonly<OrganizationMembersListProps>) {
	const { user } = useAuth()

	if (isLoading) return <OrganizationMembersLoadingState />

	if (isError || !members)
		return (
			<Card className="border-dashed p-6 text-muted-foreground text-sm">
				Members could not be loaded.
			</Card>
		)

	const ownerCount = countOrganizationOwners(members)

	return (
		<Card className="gap-0 p-0">
			<ul className="divide-y divide-border">
				{members.map(member => (
					<OrganizationMemberRow
						key={member.id}
						member={member}
						organizationId={organizationId}
						organizationName={organizationName}
						permissions={getOrganizationMemberPermissions({
							member,
							ownerCount,
							viewerRole,
							viewerUserId: user?.id,
						})}
						viewerRole={viewerRole}
					/>
				))}
			</ul>
		</Card>
	)
}

function OrganizationMembersLoadingState() {
	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{MEMBER_LOADING_ROWS.map(row => (
				<div
					className="flex items-center justify-between gap-4 px-4 py-4"
					key={row}
				>
					<div className="flex w-full flex-col gap-2">
						<div className="h-4 max-w-40 animate-pulse rounded bg-muted" />
						<div className="h-3 max-w-28 animate-pulse rounded bg-muted/70" />
					</div>
					<div className="h-8 w-28 shrink-0 animate-pulse rounded bg-muted/70" />
				</div>
			))}
		</Card>
	)
}

const MEMBER_LOADING_ROWS = ['member-1', 'member-2', 'member-3']
