import { createFileRoute } from '@tanstack/react-router'
import { OrganizationInvitationPage } from '../components/organization-invitation-page'

export const Route = createFileRoute('/invitations/$invitationId')({
	// No loader: the link is often opened signed out, and the page says so.
	head: () => ({
		meta: [
			{ title: 'Organization invitation · detent' },
			{
				name: 'description',
				content: 'Accept or decline an invitation to a detent organization.',
			},
			{ name: 'robots', content: 'noindex' },
		],
	}),
	component: InvitationRoute,
})

function InvitationRoute() {
	const { invitationId } = Route.useParams()

	return (
		<main className="mx-auto max-w-2xl px-6 py-8">
			<OrganizationInvitationPage invitationId={invitationId} />
		</main>
	)
}
