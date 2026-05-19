import type { GitHubImportRepository } from '@repo/contracts'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
	GitHubImportSourceSelector,
	isAuthenticationError,
} from './github-import-source-selector'

const repositories: GitHubImportRepository[] = [
	{
		githubId: 1,
		ownerLogin: 'mnigos',
		name: 'tessera',
		fullName: 'mnigos/tessera',
		visibility: 'private',
		defaultBranch: 'main',
		pushedAt: new Date('2026-05-12T10:30:00.000Z'),
		githubUrl: 'https://github.com/mnigos/tessera',
	},
	{
		githubId: 2,
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
				isLoading
				onSelectRepository={vi.fn()}
				repositories={[]}
			/>
		)

		expect(screen.queryByText('No repositories found')).toBeNull()
		expect(screen.queryByText('Selected source')).toBeNull()
	})

	test('shows generic error state', () => {
		render(
			<GitHubImportSourceSelector
				isError
				isLoading={false}
				onSelectRepository={vi.fn()}
				repositories={[]}
			/>
		)

		expect(screen.getByText('Repository list unavailable')).toBeTruthy()
		expect(
			screen.getByText('GitHub repositories could not be loaded.')
		).toBeTruthy()
	})

	test('shows auth failure state', () => {
		render(
			<GitHubImportSourceSelector
				error={{
					message: 'github import authentication required',
					status: 401,
				}}
				isError
				isLoading={false}
				onSelectRepository={vi.fn()}
				repositories={[]}
			/>
		)

		expect(screen.getByText('GitHub access needs attention')).toBeTruthy()
		expect(
			screen.getByText('Reconnect GitHub from your profile, then return here.')
		).toBeTruthy()
		expect(
			isAuthenticationError({
				message: 'github import authentication required',
				status: 403,
			})
		).toBe(true)
		expect(
			isAuthenticationError({ message: 'Unauthorized', status: 401 })
		).toBe(false)
	})

	test('shows empty state', () => {
		render(
			<GitHubImportSourceSelector
				isError={false}
				isLoading={false}
				onSelectRepository={vi.fn()}
				repositories={[]}
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
				isLoading={false}
				onSelectRepository={vi.fn()}
				repositories={repositories}
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

	test('selects one repository through the URL-backed callback', () => {
		const onSelectRepository = vi.fn()
		const { rerender } = render(
			<GitHubImportSourceSelector
				isError={false}
				isLoading={false}
				onSelectRepository={onSelectRepository}
				repositories={repositories}
			/>
		)

		fireEvent.click(
			screen.getByRole('button', { name: TESSERA_REPOSITORY_NAME_REGEX })
		)

		expect(onSelectRepository).toHaveBeenCalledWith(1)

		rerender(
			<GitHubImportSourceSelector
				isError={false}
				isLoading={false}
				onSelectRepository={onSelectRepository}
				repositories={repositories}
				selectedRepositoryId={1}
			/>
		)

		expect(screen.getAllByText('mnigos/tessera')).toHaveLength(2)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' })
				.disabled
		).toBe(true)
		expect(
			screen
				.getByRole('button', { name: TESSERA_REPOSITORY_NAME_REGEX })
				.getAttribute('aria-pressed')
		).toBe('true')
	})
})
