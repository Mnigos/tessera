import type {
	ListPullRequestsInput,
	PullRequestDraftFilter,
	PullRequestSort,
	PullRequestSortDirection,
	PullRequestState,
} from '@repo/contracts'

/**
 * The list widens the contract's state filter with `all`, which is the absence
 * of a state rather than a state of its own.
 */
export type PullRequestStateFilterValue = PullRequestState | 'all'

/** Everything the pull request list reads out of the URL. */
export interface PullRequestsListSearch {
	state: PullRequestStateFilterValue
	draft?: PullRequestDraftFilter
	q?: string
	sort: PullRequestSort
	direction: PullRequestSortDirection
	cursor?: string
}

/** The parts a control can change; the page is never one of them. */
export type PullRequestsListFilters = Omit<PullRequestsListSearch, 'cursor'>

/** What the list shows when the URL says nothing, and what "clear filters" restores. */
export const PULL_REQUESTS_LIST_DEFAULT_FILTERS: PullRequestsListFilters = {
	state: 'open',
	draft: undefined,
	q: undefined,
	sort: 'created',
	direction: 'desc',
}

/** The URL shape, where an omitted value means the default rather than a missing one. */
export interface PullRequestsListSearchParams {
	state?: PullRequestStateFilterValue
	draft?: PullRequestDraftFilter
	q?: string
	sort?: PullRequestSort
	direction?: PullRequestSortDirection
	cursor?: string
}

/**
 * The query string a search should be addressed by. Every value that matches its
 * default is dropped, so the untouched list carries no query string at all and a
 * shared link only ever names what was actually chosen.
 */
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

/**
 * The list request a search describes. The loader and the rendered list both
 * build it here, so a prefetched page and the page on screen share a cache key.
 */
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
