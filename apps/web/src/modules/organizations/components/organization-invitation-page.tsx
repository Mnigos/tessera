import type { MyOrganizationInvitation } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FaGithub } from 'react-icons/fa'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { formatInvitationExpiry } from '../helpers/format-invitation-expiry'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { parseInvitationId } from '../helpers/parse-invitation-id'
import { useAcceptOrganizationInvitationMutation } from '../hooks/use-accept-organization-invitation.mutation'
import { useDeclineOrganizationInvitationMutation } from '../hooks/use-decline-organization-invitation.mutation'
import { useMyOrganizationInvitationQuery } from '../hooks/use-my-organization-invitation.query'

interface OrganizationInvitationPageProps {
	invitationId: string
}

export function OrganizationInvitationPage({
	invitationId,
}: Readonly<OrganizationInvitationPageProps>) {
	const { isLoading, signIn, user } = useAuth()
	const parsedInvitationId = parseInvitationId(invitationId)

	if (isLoading) return <InvitationSkeleton />

	if (!user)
		return (
			<InvitationMessage title="Sign in to see this invitation">
				<p className="text-muted-foreground text-sm">
					Invitations are addressed to an email address, so detent has to know
					who you are before it can show you this one.
				</p>
				<Button
					className="self-start"
					// Back here, not the profile: the link is the only copy there is.
					onClick={() =>
						signIn({ callbackPath: `/invitations/${invitationId}` })
					}
				>
					<FaGithub className="size-4" />
					Sign in
				</Button>
			</InvitationMessage>
		)

	if (!parsedInvitationId)
		return (
			<InvitationMessage title="This invitation link is not valid">
				<p className="text-muted-foreground text-sm">
					Ask whoever sent it to copy the link again.
				</p>
			</InvitationMessage>
		)

	return <InvitationLoader invitationId={parsedInvitationId} />
}

interface InvitationLoaderProps {
	invitationId: string
}

function InvitationLoader({ invitationId }: Readonly<InvitationLoaderProps>) {
	const invitationQuery = useMyOrganizationInvitationQuery({ invitationId })

	if (invitationQuery.isLoading) return <InvitationSkeleton />

	if (invitationQuery.isError || !invitationQuery.data)
		return (
			<InvitationMessage title="This invitation is not available">
				<p className="text-muted-foreground text-sm">
					{getOrganizationErrorMessage(
						invitationQuery.error,
						'It may have been cancelled, already used, or sent to a different email address.'
					)}
				</p>
			</InvitationMessage>
		)

	return <InvitationCard invitation={invitationQuery.data.invitation} />
}

interface InvitationCardProps {
	invitation: MyOrganizationInvitation
}

function InvitationCard({ invitation }: Readonly<InvitationCardProps>) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const acceptInvitation = useAcceptOrganizationInvitationMutation()
	const declineInvitation = useDeclineOrganizationInvitationMutation()
	const error = acceptInvitation.error ?? declineInvitation.error
	const errorMessage =
		error &&
		getOrganizationErrorMessage(
			error,
			'This invitation could not be answered. Try again in a moment.'
		)
	const isBusy = acceptInvitation.isPending || declineInvitation.isPending

	// A declined invitation stops being readable, so say the outcome here.
	if (declineInvitation.isSuccess)
		return (
			<InvitationMessage title="Invitation declined">
				<p className="text-muted-foreground text-sm">
					You did not join {invitation.organization.name}. Someone there can
					invite you again.
				</p>
			</InvitationMessage>
		)

	function goToProfile() {
		return navigate(
			user?.username
				? { to: '/profile/$username', params: { username: user.username } }
				: { to: '/profile' }
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					/{invitation.organization.slug}
				</p>
				<h1 className="font-semibold text-2xl tracking-normal">
					Join {invitation.organization.name}
				</h1>
				<p className="text-muted-foreground text-sm">
					{invitation.inviter.username ?? invitation.inviter.displayName}{' '}
					invited {invitation.email} as{' '}
					<span className="font-medium text-foreground">{invitation.role}</span>
					. This invitation expires{' '}
					{formatInvitationExpiry(invitation.expiresAt)}.
				</p>
			</div>
			{errorMessage && (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					disabled={isBusy}
					onClick={() =>
						acceptInvitation.mutate(
							{ invitationId: invitation.id },
							{ onSuccess: goToProfile }
						)
					}
				>
					{acceptInvitation.isPending ? 'Joining' : 'Accept invitation'}
				</Button>
				<Button
					disabled={isBusy}
					onClick={() =>
						declineInvitation.mutate({ invitationId: invitation.id })
					}
					variant="secondary"
				>
					{declineInvitation.isPending ? 'Declining' : 'Decline'}
				</Button>
			</div>
		</Card>
	)
}

interface InvitationMessageProps {
	title: string
	children: ReactNode
}

function InvitationMessage({
	children,
	title,
}: Readonly<InvitationMessageProps>) {
	return (
		<Card className="gap-3">
			<h1 className="font-semibold text-2xl tracking-normal">{title}</h1>
			{children}
		</Card>
	)
}

function InvitationSkeleton() {
	return (
		<Card className="gap-4">
			<div className="h-6 max-w-56 animate-pulse rounded bg-muted" />
			<div className="h-4 max-w-72 animate-pulse rounded bg-muted/70" />
			<div className="h-9 max-w-40 animate-pulse rounded bg-muted/70" />
		</Card>
	)
}
