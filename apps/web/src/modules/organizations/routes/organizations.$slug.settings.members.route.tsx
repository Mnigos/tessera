import { createFileRoute } from '@tanstack/react-router'
import { OrganizationSettingsPanel } from '../components/organization-settings-panel'
import {
	ensureOrNotFound,
	loadOrganizationSettings,
} from '../helpers/load-organization-settings'
import { getOrganizationMembersQueryOptions } from '../hooks/use-organization-members.query'

export const Route = createFileRoute('/organizations/$slug/settings/members')({
	loader: async ({ context, params: { slug } }) => {
		const settings = await loadOrganizationSettings({ context, slug })

		await ensureOrNotFound(
			context.queryClient.ensureQueryData(
				getOrganizationMembersQueryOptions({
					organizationId: settings.organizationId,
				})
			)
		)

		return settings
	},
	head: ({ loaderData, params }) => ({
		meta: [{ title: `${loaderData?.name ?? params.slug} members · detent` }],
	}),
	component: OrganizationMembersRoute,
})

function OrganizationMembersRoute() {
	const { organizationId } = Route.useLoaderData()

	return (
		<main className="mx-auto max-w-3xl px-6 py-8">
			<OrganizationSettingsPanel
				key={organizationId}
				organizationId={organizationId}
				tab="members"
			/>
		</main>
	)
}
