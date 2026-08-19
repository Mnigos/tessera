import { routes } from '@/routes'
import { Route as commitsRoute } from './repository.$username.$slug.pulls.$number.commits.route'
import { Route as filesRoute } from './repository.$username.$slug.pulls.$number.files.route'
import { Route as overviewRoute } from './repository.$username.$slug.pulls.$number.index.route'

const REVIEW_ID = '00000000-0000-4000-8000-000000000011'
const PULL_REQUEST_PATHS = ['/pulls', '/pulls/new', '/pulls/$number']
const PULL_REQUEST_DETAIL_PATHS = ['index', '/commits', '/files']

describe('pull request routes', () => {
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
