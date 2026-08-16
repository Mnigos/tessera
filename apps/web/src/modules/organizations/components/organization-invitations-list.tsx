import type { Organization, OrganizationInvitation } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { MailPlus } from 'lucide-react'
import { OrganizationInvitationRow } from './organization-invitation-row'

interface OrganizationInvitationsListProps {
	invitations: OrganizationInvitation[] | undefined
	organizationId: Organization['id']
	isError: boolean
	isLoading: boolean
}

export function OrganizationInvitationsList({
	invitations,
	isError,
	isLoading,
	organizationId,
}: Readonly<OrganizationInvitationsListProps>) {
	if (isLoading)
		return (
			<Card className="gap-0 divide-y divide-border p-0">
				{INVITATION_LOADING_ROWS.map(row => (
					<div className="flex flex-col gap-2 px-4 py-4" key={row}>
						<div className="h-4 max-w-56 animate-pulse rounded bg-muted" />
						<div className="h-3 max-w-32 animate-pulse rounded bg-muted/70" />
					</div>
				))}
			</Card>
		)

	if (isError || !invitations)
		return (
			<Card className="border-dashed p-6 text-muted-foreground text-sm">
				Invitations could not be loaded.
			</Card>
		)

	if (invitations.length === 0)
		return (
			<Card className="flex flex-col items-center gap-2 p-8 text-center">
				<MailPlus aria-hidden className="size-6 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">
					No invitations are waiting.
				</p>
				<p className="text-muted-foreground text-sm">
					Invite someone above, then send them the link.
				</p>
			</Card>
		)

	return (
		<Card className="gap-0 p-0">
			<ul className="divide-y divide-border">
				{invitations.map(invitation => (
					<OrganizationInvitationRow
						invitation={invitation}
						key={invitation.id}
						organizationId={organizationId}
					/>
				))}
			</ul>
		</Card>
	)
}

const INVITATION_LOADING_ROWS = ['invitation-1', 'invitation-2']
