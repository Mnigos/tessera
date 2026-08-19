import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryTreeBrowser } from '../components/repository-tree-browser'
import { getRepositoryTreeQueryOptions } from '../hooks/use-repository-tree.query'

export const Route = createFileRoute('/$username/$slug/tree/$ref/$')({
	loader: async ({ context, params: { username, slug, ref, _splat = '' } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getRepositoryTreeQueryOptions({
					username,
					slug,
					ref,
					path: _splat,
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params: { username, slug, ref, _splat = '' } }) => ({
		meta: [
			{
				title: `${username}/${slug} at ${ref}${_splat ? `/${_splat}` : ''} · detent`,
			},
		],
	}),
	component: RepositoryTreeRoute,
})

function RepositoryTreeRoute() {
	const { username, slug, ref, _splat } = Route.useParams()

	return (
		<RepositoryTreeBrowser
			path={_splat ?? ''}
			refName={ref}
			slug={slug}
			username={username}
		/>
	)
}
