import { createFileRoute } from '@tanstack/react-router'
import { OrganizationSettingsPanel } from '../components/organization-settings-panel'
import { loadOrganizationSettings } from '../helpers/load-organization-settings'

export const Route = createFileRoute('/organizations/$slug/settings')({
	loader: ({ context, params: { slug } }) =>
		loadOrganizationSettings({ context, slug }),
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${loaderData?.name ?? params.slug} settings · detent`,
			},
		],
	}),
	component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
	const { organizationId } = Route.useLoaderData()

	return (
		<main className="mx-auto max-w-3xl px-6 py-8">
			<OrganizationSettingsPanel
				key={organizationId}
				organizationId={organizationId}
				tab="general"
			/>
		</main>
	)
}
