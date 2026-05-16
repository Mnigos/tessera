import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryCommitHistory } from '../components/repository-commit-history'
import { getRepositoryCommitsQueryOptions } from '../hooks/use-repository-commits.query'

export const Route = createFileRoute('/$username/$slug/commits/$ref')({
	loader: async ({ context, params }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getRepositoryCommitsQueryOptions({
					username: params.username,
					slug: params.slug,
					ref: params.ref,
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} commits at ${params.ref} · Tessera`,
			},
		],
	}),
	component: RepositoryCommitsRoute,
})

function RepositoryCommitsRoute() {
	const { username, slug, ref } = Route.useParams()

	return (
		<main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
			<RepositoryCommitHistory refName={ref} slug={slug} username={username} />
		</main>
	)
}
