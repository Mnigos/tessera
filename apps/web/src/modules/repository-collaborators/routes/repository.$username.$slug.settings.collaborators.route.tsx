import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryCollaboratorsSettings } from '../components/repository-collaborators-settings'
import { getRepositoryCollaboratorsQueryOptions } from '../hooks/use-repository-collaborators.query'

export const Route = createFileRoute('/$username/$slug/settings/collaborators')(
	{
		loader: async ({ context, params: { username, slug } }) => {
			const [error] = await safe(
				context.queryClient.ensureQueryData(
					getRepositoryCollaboratorsQueryOptions({ username, slug })
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
					title: `${params.username}/${params.slug} collaborators · detent`,
				},
			],
		}),
		component: RepositoryCollaboratorsSettingsRoute,
	}
)

function RepositoryCollaboratorsSettingsRoute() {
	const { username, slug } = Route.useParams()

	return <RepositoryCollaboratorsSettings slug={slug} username={username} />
}
