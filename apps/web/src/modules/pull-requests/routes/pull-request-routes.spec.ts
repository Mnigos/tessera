import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { routes } from '@/routes'
import { Route as commitsRoute } from './repository.$username.$slug.pulls.$number.commits.route'
import { Route as filesRoute } from './repository.$username.$slug.pulls.$number.files.route'
import { Route as overviewRoute } from './repository.$username.$slug.pulls.$number.index.route'
import { Route as pullsRoute } from './repository.$username.$slug.pulls.route'

vi.mock('../components/pull-requests-list', () => ({
	PullRequestsList: ({
		onFiltersChange,
		onPageChange,
	}: {
		onFiltersChange: (filters: { draft: 'only' }) => void
		onPageChange: (cursor: string) => void
	}) =>
		createElement(
			'div',
			undefined,
			createElement(
				'button',
				{ onClick: () => onFiltersChange({ draft: 'only' }), type: 'button' },
				'Change filters'
			),
			createElement(
				'button',
				{ onClick: () => onPageChange('next-page'), type: 'button' },
				'Change page'
			)
		),
}))

const REVIEW_ID = '00000000-0000-4000-8000-000000000011'
const PULL_REQUEST_PATHS = ['/pulls', '/pulls/new', '/pulls/$number']
const PULL_REQUEST_DETAIL_PATHS = ['index', '/commits', '/files']

describe('pull request routes', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('parses pull request list search defaults, query text, and cursors', () => {
		const searchSchema = pullsRoute.options.validateSearch as unknown as {
			parse: (search: unknown) => unknown
		}

		expect(searchSchema.parse({})).toEqual({
			state: 'open',
			sort: 'created',
			direction: 'desc',
		})
		expect(
			searchSchema.parse({
				state: 'all',
				draft: 'only',
				q: '  review  ',
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
		expect(searchSchema.parse({ q: '   ' })).toEqual({
			state: 'open',
			q: undefined,
			sort: 'created',
			direction: 'desc',
		})
	})

	test.each([
		['state', 'unknown'],
		['draft', 'all'],
		['sort', 'number'],
		['direction', 'sideways'],
	] as const)('rejects an invalid %s search value', (key, value) => {
		const searchSchema = pullsRoute.options.validateSearch as unknown as {
			parse: (search: unknown) => unknown
		}

		expect(() => searchSchema.parse({ [key]: value })).toThrow()
	})

	test('resets the cursor for filters and preserves explicit page navigation', () => {
		const navigate = vi.fn()
		vi.spyOn(pullsRoute, 'useParams').mockReturnValue({
			username: 'marta',
			slug: 'notes',
		})
		vi.spyOn(pullsRoute, 'useSearch').mockReturnValue({
			state: 'open',
			draft: undefined,
			q: undefined,
			sort: 'created',
			direction: 'desc',
			cursor: 'current-page',
		})
		vi.spyOn(pullsRoute, 'useNavigate').mockReturnValue(navigate)
		const Component = pullsRoute.options.component
		if (!Component) throw new Error('Pull request list route has no component')
		render(createElement(Component))

		fireEvent.click(screen.getByRole('button', { name: 'Change filters' }))
		fireEvent.click(screen.getByRole('button', { name: 'Change page' }))

		const [filterNavigation] = navigate.mock.calls[0] ?? []
		const [pageNavigation] = navigate.mock.calls[1] ?? []
		const previousSearch = {
			state: 'open' as const,
			draft: undefined,
			q: undefined,
			sort: 'created' as const,
			direction: 'desc' as const,
			cursor: 'current-page',
		}

		expect(filterNavigation.search(previousSearch)).toMatchObject({
			draft: 'only',
			cursor: undefined,
		})
		expect(pageNavigation.search(previousSearch)).toMatchObject({
			cursor: 'next-page',
		})
	})

	test('hangs list, create, and the detail sub-tabs off the repository shell', () => {
		const repositoryRoute = (routes.children ?? []).find(
			route => 'path' in route && route.path === '/$username/$slug'
		)
		const pullRequestRoutes = (
			(repositoryRoute && 'children' in repositoryRoute
				? repositoryRoute.children
				: undefined) ?? []
		).filter(route => 'path' in route && route.path.includes('/pulls'))
		const detailRoute = pullRequestRoutes.find(
			route => 'path' in route && route.path === '/pulls/$number'
		)

		expect(
			pullRequestRoutes.map(route => ('path' in route ? route.path : undefined))
		).toEqual(PULL_REQUEST_PATHS)
		expect(
			(detailRoute && 'children' in detailRoute
				? (detailRoute.children ?? [])
				: []
			).map(route => ('path' in route ? route.path : route.type))
		).toEqual(PULL_REQUEST_DETAIL_PATHS)
	})

	test('carries the reviewed comparison on the files page as one review id', () => {
		const searchSchema = filesRoute.options.validateSearch as unknown as {
			parse: (search: unknown) => { reviewId?: string }
		}

		expect(searchSchema.parse({})).toEqual({})
		expect(searchSchema.parse({ reviewId: REVIEW_ID })).toEqual({
			reviewId: REVIEW_ID,
		})
		// Naming a review is the whole selection, so a value that names none is
		// refused rather than quietly read as the full diff.
		expect(() => searchSchema.parse({ reviewId: 'latest' })).toThrow()
		expect(
			filesRoute.options.loaderDeps?.({
				search: { reviewId: REVIEW_ID },
			} as never)
		).toEqual({ reviewId: REVIEW_ID })
	})

	test.each([
		[overviewRoute, 'marta/notes #77 · detent', 'marta/notes #42 · detent'],
		[
			commitsRoute,
			'marta/notes #77 commits · detent',
			'marta/notes #42 commits · detent',
		],
		[
			filesRoute,
			'marta/notes #77 files changed · detent',
			'marta/notes #42 files changed · detent',
		],
	] as const)('uses the loaded display number in document titles and falls back to params', (route, loadedTitle, fallbackTitle) => {
		const params = { username: 'marta', slug: 'notes', number: '42' }

		expect(
			route.options.head?.({
				loaderData: { displayNumber: 77 },
				params,
			} as never)
		).toMatchObject({ meta: [{ title: loadedTitle }] })
		expect(
			route.options.head?.({ loaderData: undefined, params } as never)
		).toMatchObject({ meta: [{ title: fallbackTitle }] })
	})
})
