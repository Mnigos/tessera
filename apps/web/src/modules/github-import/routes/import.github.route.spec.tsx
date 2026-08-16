import { render, screen } from '@testing-library/react'
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
	useGitHubImportRepositoriesQuery: vi.fn(),
}))
vi.mock('../hooks/use-github-imports.query', () => ({
	useGitHubImportsQuery: vi.fn(),
}))

describe('GitHubImportRoute', () => {
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
