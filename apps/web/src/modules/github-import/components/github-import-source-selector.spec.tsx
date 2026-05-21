import type { GitHubImportRepository } from '@repo/contracts'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
	GitHubImportSourceSelector,
	isGitHubAccessError,
} from './github-import-source-selector'

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

describe('GitHubImportSourceSelector', () => {
	test('shows loading state', () => {
		render(
			<GitHubImportSourceSelector
				isError={false}
				isImporting={false}
				isLoading
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={[]}
				selectedRepositoryIds={[]}
			/>
		)

		expect(screen.queryByText('No repositories found')).toBeNull()
		expect(screen.queryByText('Selected sources')).toBeNull()
	})

	test('shows generic error state', () => {
		render(
			<GitHubImportSourceSelector
				isError
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={[]}
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
				isError
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onReconnectGitHub={onReconnectGitHub}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={[]}
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
				isError
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={[]}
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
				isError={false}
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={[]}
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
				isError={false}
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={repositories}
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

	test('selects multiple repositories through URL-backed callbacks', () => {
		const onContinue = vi.fn()
		const onSelectAllRepositories = vi.fn()
		const onToggleRepository = vi.fn()
		const { rerender } = render(
			<GitHubImportSourceSelector
				isError={false}
				isImporting={false}
				isLoading={false}
				onContinue={onContinue}
				onSelectAllRepositories={onSelectAllRepositories}
				onToggleRepository={onToggleRepository}
				repositories={repositories}
				selectedRepositoryIds={[]}
			/>
		)

		fireEvent.click(
			screen.getByRole('button', { name: TESSERA_REPOSITORY_NAME_REGEX })
		)

		expect(onToggleRepository).toHaveBeenCalledWith('1')

		rerender(
			<GitHubImportSourceSelector
				isError={false}
				isImporting={false}
				isLoading={false}
				onContinue={onContinue}
				onSelectAllRepositories={onSelectAllRepositories}
				onToggleRepository={onToggleRepository}
				repositories={repositories}
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
		fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
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
				importError={{
					message: 'github repository import target slug already exists',
				}}
				isError={false}
				isImporting={false}
				isLoading={false}
				onContinue={vi.fn()}
				onSelectAllRepositories={vi.fn()}
				onToggleRepository={vi.fn()}
				repositories={repositories}
				selectedRepositoryIds={['1']}
			/>
		)

		expect(
			screen.getByText('A repository with this target slug already exists.')
		).toBeTruthy()
	})
})
