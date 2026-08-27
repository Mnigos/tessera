import {
	type ListPullRequestsInput,
	PULL_REQUESTS_SEARCH_MAX_LENGTH,
	type PullRequestDraftFilter,
	type PullRequestSort,
	type PullRequestSortDirection,
	type PullRequestState,
	pullRequestDraftFilterSchema,
	pullRequestSortDirectionSchema,
	pullRequestSortSchema,
	pullRequestStateSchema,
} from '@repo/contracts'
import { z } from 'zod'

export type PullRequestStateFilterValue = PullRequestState | 'all'

export const pullRequestsListSearchSchema = z.object({
	state: pullRequestStateSchema.or(z.literal('all')).default('open'),
	draft: pullRequestDraftFilterSchema.optional(),
	q: z
		.string()
		.trim()
		.max(PULL_REQUESTS_SEARCH_MAX_LENGTH)
		.optional()
		.transform(query => (query ? query : undefined)),
	sort: pullRequestSortSchema.default('created'),
	direction: pullRequestSortDirectionSchema.default('desc'),
	cursor: z.string().optional(),
})

export interface PullRequestsListSearch {
	state: PullRequestStateFilterValue
	draft?: PullRequestDraftFilter
	q?: string
	sort: PullRequestSort
	direction: PullRequestSortDirection
	cursor?: string
}

export type PullRequestsListFilters = Omit<PullRequestsListSearch, 'cursor'>

export const PULL_REQUESTS_LIST_DEFAULT_FILTERS: PullRequestsListFilters = {
	state: 'open',
	draft: undefined,
	q: undefined,
	sort: 'created',
	direction: 'desc',
}

export interface PullRequestsListSearchParams {
	state?: PullRequestStateFilterValue
	draft?: PullRequestDraftFilter
	q?: string
	sort?: PullRequestSort
	direction?: PullRequestSortDirection
	cursor?: string
}

export function toPullRequestsListSearchParams(
	search: PullRequestsListSearch
): PullRequestsListSearchParams {
	const {
		state: defaultState,
		sort: defaultSort,
		direction: defaultDirection,
	} = PULL_REQUESTS_LIST_DEFAULT_FILTERS

	return {
		state: search.state === defaultState ? undefined : search.state,
		draft: search.draft,
		q: search.q ? search.q : undefined,
		sort: search.sort === defaultSort ? undefined : search.sort,
		direction:
			search.direction === defaultDirection ? undefined : search.direction,
		cursor: search.cursor,
	}
}

export function toListPullRequestsInput(
	username: string,
	slug: string,
	search: PullRequestsListSearch
): ListPullRequestsInput {
	return {
		username,
		slug,
		state: search.state === 'all' ? undefined : search.state,
		draft: search.draft,
		q: search.q,
		sort: search.sort,
		direction: search.direction,
		cursor: search.cursor,
	}
}
