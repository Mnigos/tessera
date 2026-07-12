import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import {
	PullRequestDetail,
	type PullRequestDetailTab,
} from '../components/pull-request-detail'
import { getPullRequestQueryOptions } from '../hooks/use-pull-request.query'
import { getPullRequestComparisonQueryOptions } from '../hooks/use-pull-request-comparison.query'

export const Route = createFileRoute('/$username/$slug/pulls/$number')({
	validateSearch: z.object({
		tab: z
			.enum(['overview', 'commits', 'files'])
			.catch('overview')
			.default('overview'),
	}),
	loaderDeps: ({ search: { tab } }) => ({ tab }),
	loader: async ({
		context,
		deps: { tab },
		params: { username, slug, number },
	}) => {
		const input = { username, slug, number }
		const queries = [
			context.queryClient.ensureQueryData(getPullRequestQueryOptions(input)),
		]
		if (tab !== 'overview')
			queries.push(
				context.queryClient.ensureQueryData(
					getPullRequestComparisonQueryOptions(input)
				)
			)
		const [error] = await safe(Promise.all(queries))

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} #${params.number} · detent`,
			},
		],
	}),
	component: PullRequestRoute,
})

function PullRequestRoute() {
	const { username, slug, number } = Route.useParams()
	const { tab } = Route.useSearch()
	const navigate = Route.useNavigate()

	const handleTabChange = (selectedTab: PullRequestDetailTab) => {
		navigate({
			search: previousSearch => ({ ...previousSearch, tab: selectedTab }),
		})
	}

	return (
		<main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
			<PullRequestDetail
				number={number}
				onTabChange={handleTabChange}
				slug={slug}
				tab={tab}
				username={username}
			/>
		</main>
	)
}
