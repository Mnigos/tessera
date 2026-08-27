import { ORPCError, safe } from '@orpc/client'
import {
	PULL_REQUESTS_SEARCH_MAX_LENGTH,
	pullRequestDraftFilterSchema,
	pullRequestSortDirectionSchema,
	pullRequestSortSchema,
	pullRequestStateSchema,
} from '@repo/contracts'
import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { PullRequestsList } from '../components/pull-requests-list'
import {
	type PullRequestsListFilters,
	toListPullRequestsInput,
	toPullRequestsListSearchParams,
} from '../helpers/pull-requests-list-search'
import { getPullRequestsListQueryOptions } from '../hooks/use-pull-requests-list.query'

export const Route = createFileRoute('/$username/$slug/pulls')({
	validateSearch: z.object({
		state: pullRequestStateSchema.or(z.literal('all')).default('open'),
		draft: pullRequestDraftFilterSchema.optional(),
		q: z
			.string()
			.trim()
			.max(PULL_REQUESTS_SEARCH_MAX_LENGTH)
			.optional()
			// A `q=` left behind by an emptied box is no search at all.
			.transform(query => (query ? query : undefined)),
		sort: pullRequestSortSchema.default('created'),
		direction: pullRequestSortDirectionSchema.default('desc'),
		cursor: z.string().optional(),
	}),
	loaderDeps: ({ search: { state, draft, q, sort, direction, cursor } }) => ({
		state,
		draft,
		q,
		sort,
		direction,
		cursor,
	}),
	loader: async ({ context, deps, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getPullRequestsListQueryOptions(
					toListPullRequestsInput(username, slug, deps)
				)
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

	/**
	 * A cursor is only valid for the ordering and the page it was issued under, so
	 * changing what is being listed always starts again from the first page.
	 */
	function handleFiltersChange(filters: Partial<PullRequestsListFilters>) {
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
