import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PullRequestDetail } from '../components/pull-request-detail'
import { getPullRequestQueryOptions } from '../hooks/use-pull-request.query'
import { getPullRequestComparisonQueryOptions } from '../hooks/use-pull-request-comparison.query'

export const Route = createFileRoute('/$username/$slug/pulls/$number/files')({
	loader: async ({ context, params: { username, slug, number } }) => {
		const input = { username, slug, number }
		const [error] = await safe(
			Promise.all([
				context.queryClient.ensureQueryData(getPullRequestQueryOptions(input)),
				context.queryClient.ensureQueryData(
					getPullRequestComparisonQueryOptions(input)
				),
			])
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} #${params.number} files changed · detent`,
			},
		],
	}),
	component: PullRequestFilesRoute,
})

function PullRequestFilesRoute() {
	const { username, slug, number } = Route.useParams()

	return (
		<main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
			<PullRequestDetail
				number={number}
				slug={slug}
				tab="files"
				username={username}
			/>
		</main>
	)
}
