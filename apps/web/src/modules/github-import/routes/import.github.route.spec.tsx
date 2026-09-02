import { render, screen } from '@testing-library/react'
import type { z } from 'zod'
import { authClient } from '@/lib/auth/client'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { useCreateGitHubImportMutation } from '../hooks/use-create-github-import.mutation'
import { useGitHubImportRepositoriesQuery } from '../hooks/use-github-import-repositories.query'
import { useGitHubImportsQuery } from '../hooks/use-github-imports.query'
import { Route } from './import.github.route'

vi.mock('@tanstack/react-router', () => ({
	createFileRoute: () => (options: Record<string, unknown>) => ({
		options,
		useSearch: vi.fn(() => ({})),
	}),
	useNavigate: vi.fn(() => vi.fn()),
}))

const PERSONAL_IMPORT_COPY_REGEX = /under your own handle/i
vi.mock('@/lib/auth/client', () => ({
	authClient: { linkSocial: vi.fn() },
}))
vi.mock('@/modules/auth/hooks/use-auth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/use-create-github-import.mutation', () => ({
	useCreateGitHubImportMutation: vi.fn(),
}))
vi.mock('../hooks/use-github-import-repositories.query', () => ({
	getGitHubImportRepositoriesInfiniteOptions: vi.fn(input => ({
		queryKey: ['repositories', input],
	})),
	useGitHubImportRepositoriesQuery: vi.fn(),
}))
vi.mock('../hooks/use-github-imports.query', () => ({
	getGitHubImportsQueryOptions: vi.fn(() => ({ queryKey: ['imports'] })),
	useGitHubImportsQuery: vi.fn(),
}))

describe('GitHubImportRoute', () => {
	test('prefetches repositories and imports for signed-in readers', async () => {
		const ensureInfiniteQueryData = vi.fn().mockRejectedValue(new Error('401'))
		const ensureQueryData = vi.fn().mockResolvedValue({ imports: [] })
		const context = {
			queryClient: { ensureInfiniteQueryData, ensureQueryData },
			user: { id: 'user-1' },
		}
		const loader = Route.options.loader as (options: unknown) => Promise<void>

		expect(
			(Route.options.loaderDeps as (options: unknown) => unknown)({
				search: { q: 'ludus' },
			})
		).toEqual({ q: 'ludus' })
		await expect(
			loader({ context, deps: { q: 'ludus' } })
		).resolves.toBeUndefined()
		expect(ensureInfiniteQueryData).toHaveBeenCalledWith({
			queryKey: ['repositories', { search: 'ludus' }],
		})
		expect(ensureQueryData).toHaveBeenCalledWith({ queryKey: ['imports'] })

		await loader({ context: { ...context, user: undefined }, deps: {} })
		expect(ensureInfiniteQueryData).toHaveBeenCalledOnce()
	})

	test('drops blank or over-long search queries instead of failing the route', () => {
		const validateSearch = Route.options.validateSearch as z.ZodType

		expect(validateSearch.parse({ q: ' ludus ' })).toEqual({ q: 'ludus' })
		expect(validateSearch.parse({ q: '   ' })).toEqual({ q: undefined })
		expect(validateSearch.parse({ q: 'x'.repeat(201) })).toEqual({
			q: undefined,
		})
	})

	test('states that GitHub imports remain personally owned', () => {
		vi.mocked(useAuth).mockReturnValue({
			isLoading: true,
			signIn: vi.fn(),
			user: null,
		} as never)
		vi.mocked(useGitHubImportRepositoriesQuery).mockReturnValue({} as never)
		vi.mocked(useGitHubImportsQuery).mockReturnValue({} as never)
		vi.mocked(useCreateGitHubImportMutation).mockReturnValue({} as never)
		vi.mocked(authClient.linkSocial).mockResolvedValue({} as never)
		const Component = Route.options.component

		expect(Component).toBeTruthy()
		if (!Component) throw new Error('GitHub import route component is missing')

		render(<Component />)

		const copy = screen.getByText(PERSONAL_IMPORT_COPY_REGEX)
		expect(copy.textContent).toContain(
			'organizations cannot own an imported repository yet'
		)
	})
})
