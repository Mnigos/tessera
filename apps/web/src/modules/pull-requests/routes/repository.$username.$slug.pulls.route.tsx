import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { PullRequestsList } from '../components/pull-requests-list'
import {
	type PullRequestsListFilters,
	pullRequestsListSearchSchema,
	toListPullRequestsInput,
	toPullRequestsListSearchParams,
} from '../helpers/pull-requests-list-search'
import { getPullRequestsListQueryOptions } from '../hooks/use-pull-requests-list.query'

export const Route = createFileRoute('/$username/$slug/pulls')({
	validateSearch: z.object({
		state: pullRequestStateSchema.or(z.literal('all')).default('open'),
	}),
	loader: async ({ context, deps, params: { username, slug } }) => {
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

		// A refused cursor — stale bookmark, changed ordering — would otherwise
		// dead-end the whole route, with reloading only replaying the same token.
		// The first page is always a valid place to recover to.
		if (
			error instanceof ORPCError &&
			error.status === 400 &&
			deps.cursor !== undefined
		)
			throw redirect({
				to: '/$username/$slug/pulls',
				params: { username, slug },
				search: { ...deps, cursor: undefined },
			})

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
	const search = Route.useSearch()
	const navigate = Route.useNavigate()

	function handleSelectedStateChange(selectedState: PullRequestState | 'all') {
		navigate({
			search: previousSearch =>
				toPullRequestsListSearchParams({
					...previousSearch,
					...filters,
					cursor: undefined,
				}),
		})
	}

	function handlePageChange(cursor: string | undefined) {
		navigate({
			search: previousSearch =>
				toPullRequestsListSearchParams({ ...previousSearch, cursor }),
		})
	}

	return (
		<PullRequestsList
			onFiltersChange={handleFiltersChange}
			onPageChange={handlePageChange}
			search={search}
			slug={slug}
			username={username}
		/>
	)
}
