import { redirect } from '@tanstack/react-router'
import { Route as profileUsernameRoute } from './profile.$username.route'
import { Route as profileRoute } from './profile.route'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: vi.fn(() => (options: Record<string, unknown>) => ({
		options,
	})),
	Outlet: () => null,
	redirect: vi.fn(options => Object.assign(new Error('redirect'), { options })),
}))

describe('profile redirects', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test('redirects a legacy username profile to its unified handle', () => {
		const beforeLoad = profileUsernameRoute.options.beforeLoad
		if (!beforeLoad) throw new Error('Expected profile username beforeLoad')

		expect(() =>
			beforeLoad({ params: { username: 'alice' } } as never)
		).toThrow('redirect')
		expect(redirect).toHaveBeenCalledWith({
			to: '/$handle',
			params: { handle: 'alice' },
		})
	})

	test('redirects the signed-in profile root to its unified handle', () => {
		const loader = profileRoute.options.loader
		if (typeof loader !== 'function') throw new Error('Expected profile loader')

		expect(() =>
			loader({
				context: { user: { username: 'alice' } },
				location: { pathname: '/profile' },
			} as never)
		).toThrow('redirect')
		expect(redirect).toHaveBeenCalledWith({
			to: '/$handle',
			params: { handle: 'alice' },
		})
	})
})
