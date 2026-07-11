import { routes } from '@/routes'

const PULL_REQUEST_PATHS = [
	'/$username/$slug/pulls',
	'/$username/$slug/pulls/new',
	'/$username/$slug/pulls/$number',
]

describe('pull request routes', () => {
	test('registers list, create, and detail as independently renderable routes', () => {
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
})
