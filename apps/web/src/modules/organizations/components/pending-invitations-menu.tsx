import { Button } from '@repo/ui/components/button'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@repo/ui/components/popover'
import { Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { formatInvitationExpiry } from '../helpers/format-invitation-expiry'
import { useMyOrganizationInvitationsQuery } from '../hooks/use-my-organization-invitations.query'

interface PendingInvitationsMenuProps {
	enabled: boolean
}

export function PendingInvitationsMenu({
	enabled,
}: Readonly<PendingInvitationsMenuProps>) {
	const invitationsQuery = useMyOrganizationInvitationsQuery(enabled)
	const invitations = invitationsQuery.data?.invitations ?? []

	if (!enabled || invitations.length === 0) return null

	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						aria-label={`${invitations.length} pending organization invitations`}
						size="sm"
						variant="secondary"
					/>
				}
			>
				<Mail className="size-4" />
				{invitations.length}
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 p-0">
				<p className="px-3 py-2 font-medium text-sm">Invitations</p>
				<ul className="divide-y divide-border border-border border-t">
					{invitations.map(invitation => (
						<li key={invitation.id}>
							<Link
								className="flex flex-col gap-0.5 px-3 py-2 hover:bg-secondary/60"
								params={{ invitationId: invitation.id }}
								to="/invitations/$invitationId"
							>
								<span className="truncate font-medium text-sm">
									{invitation.organization.name}
								</span>
								<span className="truncate text-muted-foreground text-xs">
									{invitation.role} · expires{' '}
									{formatInvitationExpiry(invitation.expiresAt)}
								</span>
							</Link>
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	)
}
