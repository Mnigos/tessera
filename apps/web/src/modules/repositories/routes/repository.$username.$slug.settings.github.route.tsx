import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryGitHubSettings } from '../components/repository-github-settings'
import { getRepositoryQueryOptions } from '../hooks/use-repository.query'

export const Route = createFileRoute('/$username/$slug/settings/github')({
	loader: async ({ context, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getRepositoryQueryOptions({ username, slug })
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
				title: `${params.username}/${params.slug} GitHub · detent`,
			},
		],
	}),
	component: RepositoryGitHubSettingsRoute,
})

function RepositoryGitHubSettingsRoute() {
	const { username, slug } = Route.useParams()

	return <RepositoryGitHubSettings slug={slug} username={username} />
}
