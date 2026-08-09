import { routes } from '@/routes'
import { Route as filesRoute } from './repository.$username.$slug.pulls.$number.files.route'

const REVIEW_ID = '00000000-0000-4000-8000-000000000011'
const PULL_REQUEST_PATHS = [
	'/$username/$slug/pulls',
	'/$username/$slug/pulls/new',
	'/$username/$slug/pulls/$number',
	'/$username/$slug/pulls/$number/commits',
	'/$username/$slug/pulls/$number/files',
]

describe('pull request routes', () => {
	test('registers list, create, overview, commits, and files as separate pages', () => {
		const pullRequestRoutes = (routes.children ?? []).filter(
			route => 'path' in route && route.path?.includes('/pulls')
		)

		expect(
			pullRequestRoutes.map(route => ('path' in route ? route.path : undefined))
		).toEqual(PULL_REQUEST_PATHS)
		expect(
			pullRequestRoutes.every(
				route => !('children' in route) || route.children === undefined
			)
		).toBeTruthy()
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
})
