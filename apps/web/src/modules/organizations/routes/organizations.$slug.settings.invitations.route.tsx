import { createFileRoute } from '@tanstack/react-router'
import { OrganizationSettingsPanel } from '../components/organization-settings-panel'
import {
	ensureOrNotFound,
	loadOrganizationSettings,
} from '../helpers/load-organization-settings'
import { getOrganizationInvitationsQueryOptions } from '../hooks/use-organization-invitations.query'

export const Route = createFileRoute(
	'/organizations/$slug/settings/invitations'
)({
	loader: async ({ context, params: { slug } }) => {
		const settings = await loadOrganizationSettings({ context, slug })

		// Members are not offered this tab, and the API answers them with a 403.
		if (settings.viewerRole !== 'member')
			await ensureOrNotFound(
				context.queryClient.ensureQueryData(
					getOrganizationInvitationsQueryOptions({
						organizationId: settings.organizationId,
					})
				)
			)

		return settings
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{ title: `${loaderData?.name ?? params.slug} invitations · detent` },
		],
	}),
	component: OrganizationInvitationsRoute,
})

function OrganizationInvitationsRoute() {
	const { organizationId } = Route.useLoaderData()

	return (
		<main className="mx-auto max-w-3xl px-6 py-8">
			<OrganizationSettingsPanel
				key={organizationId}
				organizationId={organizationId}
				tab="invitations"
			/>
		</main>
	)
}
