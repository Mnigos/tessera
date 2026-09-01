import type { GitHubImportRepository } from '@repo/contracts'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { isGitHubAccessError } from '../helpers/is-github-access-error'
import { GitHubImportSourceSelector } from './github-import-source-selector'

const repositories: GitHubImportRepository[] = [
	{
		githubId: '1',
		ownerLogin: 'mnigos',
		name: 'tessera',
		fullName: 'mnigos/tessera',
		visibility: 'private',
		defaultBranch: 'main',
		pushedAt: new Date('2026-05-12T10:30:00.000Z'),
		githubUrl: 'https://github.com/mnigos/tessera',
	},
	{
		githubId: '2',
		ownerLogin: 'ludus',
		name: 'engine',
		fullName: 'ludus/engine',
		visibility: 'public',
		defaultBranch: 'trunk',
		githubUrl: 'https://github.com/ludus/engine',
	},
]
const TESSERA_REPOSITORY_NAME_REGEX = /mnigos\/tessera/
const TESSERA_PUSHED_DATE_REGEX = /Pushed May 12, 2026/

function renderSelector(
	overrides: Partial<ComponentProps<typeof GitHubImportSourceSelector>> = {}
) {
	return render(
		<GitHubImportSourceSelector
			hasNextPage={false}
			isError={false}
			isFetchingNextPage={false}
			isFetchNextPageError={false}
			isImporting={false}
			isLoading={false}
			isSearching={false}
			onContinue={vi.fn()}
			onLoadMore={vi.fn()}
			onQueryChange={vi.fn()}
			onSelectAllRepositories={vi.fn()}
			onToggleRepository={vi.fn()}
			pageCount={1}
			query=""
			repositories={repositories}
			selectedRepositories={[]}
			selectedRepositoryIds={[]}
			{...overrides}
		/>
	)
}

describe('GitHubImportSourceSelector', () => {
	test('shows loading state', () => {
		render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={[]}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.queryByText('No repositories found')).toBeNull()
		expect(screen.queryByText('Selected sources')).toBeNull()
	})

	test('shows generic error state', () => {
		render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={[]}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.getByText('Repository list unavailable')).toBeTruthy()
		expect(
			screen.getByText('GitHub repositories could not be loaded.')
		).toBeTruthy()
	})

	test('shows auth failure state', () => {
		const onReconnectGitHub = vi.fn()

		render(
			<GitHubImportSourceSelector
				error={{
					message: 'github import authentication required',
					status: 401,
				}}
				hasNextPage={false}
				isError
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onReconnectGitHub={onReconnectGitHub}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={[]}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.getByText('GitHub access needs attention')).toBeTruthy()
		expect(
			screen.getByText(
				'Reconnect GitHub with repository access, then return here.'
			)
		).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }))
		expect(onReconnectGitHub).toHaveBeenCalledOnce()
	})

	test('shows reconnect state for GitHub permission failures', () => {
		render(
			<GitHubImportSourceSelector
				error={{
					message: 'github import access denied',
					status: 403,
				}}
				hasNextPage={false}
				isError
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={[]}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.getByText('GitHub access needs attention')).toBeTruthy()
		expect(isGitHubAccessError({ message: 'Forbidden', status: 403 })).toBe(
			true
		)
		expect(
			isGitHubAccessError({ code: 'FORBIDDEN', message: 'Forbidden' })
		).toBe(true)
		expect(isGitHubAccessError({ code: 'UNAUTHORIZED' })).toBe(true)
		expect(isGitHubAccessError({ status: 401 })).toBe(true)
		expect(isGitHubAccessError({ message: 'Internal Server Error' })).toBe(
			false
		)
	})

	test('shows empty state', () => {
		render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={[]}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.getByText('No repositories found')).toBeTruthy()
		expect(
			screen.getByText('No GitHub repositories are available for import yet.')
		).toBeTruthy()
	})

	test('renders repository metadata', () => {
		render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={repositories}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		const tesseraRow = screen.getByRole('button', {
			name: TESSERA_REPOSITORY_NAME_REGEX,
		})

		expect(within(tesseraRow).getByText('private')).toBeTruthy()
		expect(within(tesseraRow).getByText('main')).toBeTruthy()
		expect(within(tesseraRow).getByText(TESSERA_PUSHED_DATE_REGEX)).toBeTruthy()
		expect(screen.getByText('ludus/engine')).toBeTruthy()
		expect(screen.getByText('trunk')).toBeTruthy()
	})

	test('renders and submits repository search', () => {
		const onQueryChange = vi.fn()
		renderSelector({ onQueryChange })
		const input = screen.getByRole<HTMLInputElement>('textbox', {
			name: 'Search repositories',
		})

		expect(input.maxLength).toBe(200)
		fireEvent.change(input, { target: { value: 'ludus' } })
		fireEvent.submit(input.closest('form') ?? input)

		expect(onQueryChange).toHaveBeenCalledWith('ludus')
	})

	test('labels selection for all loaded repositories', () => {
		const rendered = renderSelector()

		expect(
			screen.getByRole('button', { name: 'Select all loaded' })
		).toBeTruthy()

		rendered.rerender(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={repositories}
				selectedRepositories={repositories}
				selectedRepositoryIds={['1', '2']}
			/>
		)

		expect(screen.getByRole('button', { name: 'Deselect loaded' })).toBeTruthy()
	})

	test('counts URL selection ids even when fewer repositories are resolved', () => {
		renderSelector({
			selectedRepositories: [repositories[0]],
			selectedRepositoryIds: ['1', '404'],
		})

		expect(screen.getByText('2 selected')).toBeTruthy()
		expect(screen.getByText('2 repositories ready to import.')).toBeTruthy()
	})

	test('shows a finished search empty state', () => {
		renderSelector({ query: 'ludus', repositories: [] })

		expect(screen.getByText('No repositories found')).toBeTruthy()
		expect(screen.getByText('No repositories match "ludus".')).toBeTruthy()
	})

	test('keeps scanning without an empty message while search has more pages', () => {
		renderSelector({
			hasNextPage: true,
			query: 'ludus',
			repositories: [],
		})

		expect(
			screen.getByText('No matches yet. Scanning more repositories...')
		).toBeTruthy()
		expect(screen.queryByText('No repositories found')).toBeNull()
		expect(screen.queryByText('No repositories match "ludus".')).toBeNull()
	})

	test('keeps loaded repositories after a non-auth list error', () => {
		renderSelector({ isError: true, error: { status: 500 } })

		expect(screen.getByText('mnigos/tessera')).toBeTruthy()
		expect(screen.queryByText('Repository list unavailable')).toBeNull()
	})

	test('shows reconnect state after an auth error with loaded repositories', () => {
		renderSelector({ isError: true, error: { status: 401 } })

		expect(screen.getByText('GitHub access needs attention')).toBeTruthy()
		expect(screen.queryByText('mnigos/tessera')).toBeNull()
	})

	test('shows the error state when a search fails with loaded repositories', () => {
		renderSelector({ isError: true, isSearching: true })

		expect(screen.getByText('Repository list unavailable')).toBeTruthy()
		expect(screen.queryByText('mnigos/tessera')).toBeNull()
	})

	test('selects multiple repositories through URL-backed callbacks', () => {
		const onContinue = vi.fn()
		const onSelectAllRepositories = vi.fn()
		const onToggleRepository = vi.fn()
		const { rerender } = render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={onContinue}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={onSelectAllRepositories}
				onToggleRepository={onToggleRepository}
				pageCount={1}
				query=""
				repositories={repositories}
				selectedRepositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		fireEvent.click(
			screen.getByRole('button', { name: TESSERA_REPOSITORY_NAME_REGEX })
		)

		expect(onToggleRepository).toHaveBeenCalledWith('1')

		rerender(
			<GitHubImportSourceSelector
				hasNextPage={false}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={onContinue}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={onSelectAllRepositories}
				onToggleRepository={onToggleRepository}
				pageCount={1}
				query=""
				repositories={repositories}
				selectedRepositories={repositories}
				selectedRepositoryIds={['1', '2']}
			/>
		)

		expect(screen.getByText('2 repositories ready to import.')).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' })
				.disabled
		).toBe(false)
		fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
		expect(onContinue).toHaveBeenCalledOnce()
		fireEvent.click(screen.getByRole('button', { name: 'Deselect loaded' }))
		expect(onSelectAllRepositories).toHaveBeenCalledOnce()
		expect(
			screen
				.getByRole('button', { name: TESSERA_REPOSITORY_NAME_REGEX })
				.getAttribute('aria-pressed')
		).toBe('true')
	})

	test('shows friendly import conflict messages', () => {
		render(
			<GitHubImportSourceSelector
				hasNextPage={false}
				importError={{
					message: 'github repository import target slug already exists',
				}}
				isError={false}
				isFetchingNextPage={false}
				isFetchNextPageError={false}
				isImporting={false}
				isLoading={false}
				isSearching={false}
				onContinue={vi.fn()}
				onLoadMore={vi.fn()}
				onQueryChange={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				pageCount={1}
				query=""
				repositories={repositories}
				selectedRepositories={[repositories[0]]}
				selectedRepositoryIds={['1']}
			/>
		)

		expect(
			screen.getByText('A repository with this target slug already exists.')
		).toBeTruthy()
	})
})
