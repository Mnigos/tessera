import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PullRequestDetail } from '../components/pull-request-detail'
import { toPullRequestDisplayNumber } from '../helpers/pull-request-display-number'
import { getPullRequestQueryOptions } from '../hooks/use-pull-request.query'
import { getPullRequestComparisonQueryOptions } from '../hooks/use-pull-request-comparison.query'

export const Route = createFileRoute('/$username/$slug/pulls/$number/commits')({
	loader: async ({ context, params: { username, slug, number } }) => {
		const input = { username, slug, number }
		const [error, data] = await safe(
			Promise.all([
				context.queryClient.ensureQueryData(getPullRequestQueryOptions(input)),
				context.queryClient.ensureQueryData(
					getPullRequestComparisonQueryOptions(input)
				),
			])
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		const [{ pullRequest }] = data

		return { displayNumber: toPullRequestDisplayNumber(pullRequest) }
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} #${loaderData?.displayNumber ?? params.number} commits · detent`,
			},
		],
	}),
	component: PullRequestCommitsRoute,
})

function PullRequestCommitsRoute() {
	const { username, slug, number } = Route.useParams()

	return (
		<PullRequestDetail
			number={number}
			slug={slug}
			tab="commits"
			username={username}
		/>
	)
}
