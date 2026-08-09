import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { CheckStatusProvidersSettings } from '../components/check-status-providers-settings'
import { getCheckStatusProvidersQueryOptions } from '../hooks/use-check-status-providers.query'

export const Route = createFileRoute(
	'/$username/$slug/settings/status-providers'
)({
	loader: async ({ context, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getCheckStatusProvidersQueryOptions({ username, slug })
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (
			error instanceof ORPCError &&
			(error.status === 401 || error.status === 403)
		)
			return

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} status providers · detent`,
			},
		],
	}),
	component: CheckStatusProvidersSettingsRoute,
})

function CheckStatusProvidersSettingsRoute() {
	const { username, slug } = Route.useParams()

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			<CheckStatusProvidersSettings slug={slug} username={username} />
		</main>
	)
}
