import type { GitHubImportRepository } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { GitHubImportSelectedSource } from './github-import-selected-source'

const repositories: GitHubImportRepository[] = [
	{
		githubId: '1',
		ownerLogin: 'mnigos',
		name: 'tessera',
		fullName: 'mnigos/tessera',
		visibility: 'private',
		defaultBranch: 'main',
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

describe(GitHubImportSelectedSource.name, () => {
	test('uses selectedCount for readiness copy and Continue state', () => {
		const rendered = render(
			<GitHubImportSelectedSource
				isImporting={false}
				onContinue={vi.fn()}
				repositories={repositories.slice(0, 1)}
				selectedCount={3}
			/>
		)

		expect(screen.getByText('3 repositories ready to import.')).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' })
				.disabled
		).toBe(false)

		rendered.rerender(
			<GitHubImportSelectedSource
				isImporting={false}
				onContinue={vi.fn()}
				repositories={repositories.slice(0, 1)}
				selectedCount={0}
			/>
		)

		expect(
			screen.getByText('Choose GitHub repositories to continue.')
		).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' })
				.disabled
		).toBe(true)
	})

	test('renders names from resolved repositories', () => {
		render(
			<GitHubImportSelectedSource
				isImporting={false}
				onContinue={vi.fn()}
				repositories={repositories}
				selectedCount={2}
			/>
		)

		expect(screen.getByText('mnigos/tessera')).toBeTruthy()
		expect(screen.getByText('ludus/engine')).toBeTruthy()
	})
})
