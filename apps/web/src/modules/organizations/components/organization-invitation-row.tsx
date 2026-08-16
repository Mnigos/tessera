import type { Organization, OrganizationInvitation } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Check, Copy, RotateCw, X } from 'lucide-react'
import { useState } from 'react'
import { buildInvitationUrl } from '../helpers/build-invitation-url'
import { formatInvitationExpiry } from '../helpers/format-invitation-expiry'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { useCancelOrganizationInvitationMutation } from '../hooks/use-cancel-organization-invitation.mutation'
import { useResendOrganizationInvitationMutation } from '../hooks/use-resend-organization-invitation.mutation'

const COPIED_FEEDBACK_MS = 2000

interface OrganizationInvitationRowProps {
	invitation: OrganizationInvitation
	organizationId: Organization['id']
}

export function OrganizationInvitationRow({
	invitation,
	organizationId,
}: Readonly<OrganizationInvitationRowProps>) {
	const [isCopied, setIsCopied] = useState(false)
	const resendInvitation = useResendOrganizationInvitationMutation()
	const cancelInvitation = useCancelOrganizationInvitationMutation()
	const error = resendInvitation.error ?? cancelInvitation.error
	const errorMessage =
		error &&
		getOrganizationErrorMessage(error, 'This invitation could not be updated.')

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(
				buildInvitationUrl(window.location.origin, invitation.id)
			)
			setIsCopied(true)
			setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS)
		} catch {
			setIsCopied(false)
		}
	}

	return (
		<li className="flex flex-col gap-2 px-4 py-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">{invitation.email}</p>
					<p className="truncate text-muted-foreground text-xs capitalize">
						{invitation.role}
						<span className="lowercase">
							{' · expires '}
							{formatInvitationExpiry(invitation.expiresAt)}
						</span>
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						aria-label={`Copy invitation link for ${invitation.email}`}
						onClick={handleCopy}
						size="sm"
						variant="ghost"
					>
						{isCopied ? (
							<Check className="size-4" />
						) : (
							<Copy className="size-4" />
						)}
						{isCopied ? 'Copied' : 'Copy link'}
					</Button>
					<Button
						aria-label={`Resend invitation for ${invitation.email}`}
						disabled={resendInvitation.isPending}
						onClick={() =>
							resendInvitation.mutate({
								organizationId,
								invitationId: invitation.id,
							})
						}
						size="icon"
						variant="ghost"
					>
						<RotateCw className="size-4 text-muted-foreground" />
					</Button>
					<Button
						aria-label={`Cancel invitation for ${invitation.email}`}
						disabled={cancelInvitation.isPending}
						onClick={() =>
							cancelInvitation.mutate({
								organizationId,
								invitationId: invitation.id,
							})
						}
						size="icon"
						variant="ghost"
					>
						<X className="size-4 text-muted-foreground" />
					</Button>
				</div>
			</div>
			{errorMessage && (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			)}
		</li>
	)
}
