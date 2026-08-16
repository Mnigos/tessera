import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { OrganizationSettings } from '../components/organization-settings'
import { findOrganizationMembership } from '../helpers/find-organization-membership'
import { getOrganizationQueryOptions } from '../hooks/use-organization.query'
import { getOrganizationsQueryOptions } from '../hooks/use-organizations.query'

export const Route = createFileRoute('/organizations/$slug/settings')({
	loader: async ({ context, params: { slug } }) => {
		if (!context.user) throw redirect({ to: '/' })

		const { organizations } = await context.queryClient.ensureQueryData(
			getOrganizationsQueryOptions()
		)
		const membership = findOrganizationMembership(organizations, slug)

		// A handle the viewer is not a member of is indistinguishable from one
		// that does not exist, which is the answer the API gives too.
		if (!membership) throw notFound()

		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getOrganizationQueryOptions({ organizationId: membership.id })
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		return { name: membership.name }
	},
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
	const { slug } = Route.useParams()

	return (
		<main className="mx-auto max-w-3xl px-6 py-8">
			<OrganizationSettings slug={slug} />
		</main>
	)
}
