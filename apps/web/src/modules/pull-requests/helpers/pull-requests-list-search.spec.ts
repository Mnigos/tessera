import {
	PULL_REQUESTS_LIST_DEFAULT_FILTERS,
	toListPullRequestsInput,
	toPullRequestsListSearchParams,
} from './pull-requests-list-search'

describe(toPullRequestsListSearchParams.name, () => {
	test('strips default filters and an empty query', () => {
		expect(
			toPullRequestsListSearchParams({
				...PULL_REQUESTS_LIST_DEFAULT_FILTERS,
				q: '',
			})
		).toEqual({
			state: undefined,
			draft: undefined,
			q: undefined,
			sort: undefined,
			direction: undefined,
			cursor: undefined,
		})
	})

	test('keeps non-default filters and the current cursor', () => {
		expect(
			toPullRequestsListSearchParams({
				state: 'all',
				draft: 'only',
				q: 'review',
				sort: 'activity',
				direction: 'asc',
				cursor: 'next-page',
			})
		).toEqual({
			state: 'all',
			draft: 'only',
			q: 'review',
			sort: 'activity',
			direction: 'asc',
			cursor: 'next-page',
		})
	})

	test('drops a cursor when the route handler resets it', () => {
		expect(
			toPullRequestsListSearchParams({
				...PULL_REQUESTS_LIST_DEFAULT_FILTERS,
				cursor: undefined,
			})
		).toMatchObject({ cursor: undefined })
	})
})

describe(toListPullRequestsInput.name, () => {
	test('converts the all-state filter to an omitted API state', () => {
		expect(
			toListPullRequestsInput('marta', 'notes', {
				state: 'all',
				draft: 'exclude',
				q: 'branch',
				sort: 'updated',
				direction: 'asc',
				cursor: 'page-two',
			})
		).toEqual({
			username: 'marta',
			slug: 'notes',
			state: undefined,
			draft: 'exclude',
			q: 'branch',
			sort: 'updated',
			direction: 'asc',
			cursor: 'page-two',
		})
	})
})
