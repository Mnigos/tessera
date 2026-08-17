import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PullRequestDetail } from '../components/pull-request-detail'
import { toPullRequestDisplayNumber } from '../helpers/pull-request-display-number'
import { getPullRequestQueryOptions } from '../hooks/use-pull-request.query'

export const Route = createFileRoute('/$username/$slug/pulls/$number')({
	validateSearch: z.object({
		tab: z.string().optional(),
	}),
	beforeLoad: ({ params, search }) => {
		if (!search.tab) return

		if (search.tab === 'commits')
			throw redirect({
				to: '/$username/$slug/pulls/$number/commits',
				params,
			})

		if (search.tab === 'files')
			throw redirect({
				to: '/$username/$slug/pulls/$number/files',
				params,
			})

		throw redirect({
			to: '/$username/$slug/pulls/$number',
			params,
			search: {},
		})
	},
	loader: async ({ context, params: { username, slug, number } }) => {
		const [error, data] = await safe(
			context.queryClient.ensureQueryData(
				getPullRequestQueryOptions({ username, slug, number })
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		return { displayNumber: toPullRequestDisplayNumber(data.pullRequest) }
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} #${loaderData?.displayNumber ?? params.number} · detent`,
			},
		],
	}),
	component: PullRequestOverviewRoute,
})

function PullRequestOverviewRoute() {
	const { username, slug, number } = Route.useParams()

	return (
		<main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
			<PullRequestDetail
				number={number}
				slug={slug}
				tab="overview"
				username={username}
			/>
		</main>
	)
}
