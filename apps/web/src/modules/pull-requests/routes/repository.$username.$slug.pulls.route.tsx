import { ORPCError, safe } from '@orpc/client'
import { type PullRequestState, pullRequestStateSchema } from '@repo/contracts'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { PullRequestsList } from '../components/pull-requests-list'
import { getPullRequestsListQueryOptions } from '../hooks/use-pull-requests-list.query'

export const Route = createFileRoute('/$username/$slug/pulls')({
	validateSearch: z.object({
		state: pullRequestStateSchema.or(z.literal('all')).default('open'),
	}),
	loaderDeps: ({ search: { state } }) => ({ state }),
	loader: async ({ context, deps: { state }, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getPullRequestsListQueryOptions({
					username,
					slug,
					state: state === 'all' ? undefined : state,
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} pull requests · detent`,
			},
		],
	}),
	component: RepositoryPullRequestsRoute,
})

function RepositoryPullRequestsRoute() {
	const { username, slug } = Route.useParams()
	const { state } = Route.useSearch()
	const navigate = Route.useNavigate()

	function handleSelectedStateChange(selectedState: PullRequestState | 'all') {
		navigate({
			search: previousSearch => ({ ...previousSearch, state: selectedState }),
		})
	}

	return (
		<PullRequestsList
			onSelectedStateChange={handleSelectedStateChange}
			selectedState={state}
			slug={slug}
			username={username}
		/>
	)
}
