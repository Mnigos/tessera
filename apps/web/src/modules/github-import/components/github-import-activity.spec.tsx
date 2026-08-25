import type { GitHubRepositoryImport } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useRetryGitHubImportMutation } from '../hooks/use-retry-github-import.mutation'
import { GitHubImportActivity } from './github-import-activity'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params?: Record<string, string>
		to: string
	}) => {
		const href = params
			? to.replace('$username', params.username).replace('$slug', params.slug)
			: to

		return (
			<a href={href} {...props}>
				{children}
			</a>
		)
	},
}))

vi.mock('../hooks/use-retry-github-import.mutation', () => ({
	useRetryGitHubImportMutation: vi.fn(),
}))

const useRetryGitHubImportMutationMock = vi.mocked(useRetryGitHubImportMutation)

const TARGET_LABEL_PATTERN = /Target:/

type RetryMutation = ReturnType<typeof useRetryGitHubImportMutation>

function mockRetryMutation() {
	useRetryGitHubImportMutationMock.mockReturnValue({
		mutate: vi.fn(),
		isPending: false,
		isError: false,
	} as unknown as RetryMutation)
}

function getImport(
	overrides: Partial<GitHubRepositoryImport> = {}
): GitHubRepositoryImport {
	return {
		id: '0f8fad5b-d9cb-469f-a165-70867728950e' as GitHubRepositoryImport['id'],
		provider: 'github',
		targetName: 'tessera',
		targetSlug: 'tessera' as GitHubRepositoryImport['targetSlug'],
		source: {
			githubId: '1',
			ownerLogin: 'mnigos',
			name: 'tessera',
			fullName: 'mnigos/tessera',
			visibility: 'private',
			defaultBranch: 'main',
			githubUrl: 'https://github.com/mnigos/tessera',
		},
		status: 'pending',
		createdAt: new Date('2026-05-12T10:30:00.000Z'),
		updatedAt: new Date('2026-05-12T10:30:00.000Z'),
		...overrides,
	}
}

describe('GitHubImportActivity', () => {
	beforeEach(() => {
		mockRetryMutation()
	})

	test('shows the loading placeholder while imports are loading', () => {
		const { container } = render(
			<GitHubImportActivity imports={[]} isError={false} isLoading />
		)

		expect(screen.queryByText('Recent imports')).toBeNull()
		expect(container.querySelector('.animate-pulse')).toBeTruthy()
	})

	test('shows the unavailable state when imports fail to load', () => {
		render(<GitHubImportActivity imports={[]} isError isLoading={false} />)

		expect(screen.getByText('Import activity unavailable')).toBeTruthy()
		expect(
			screen.getByText('Recent GitHub imports could not be loaded.')
		).toBeTruthy()
	})

	test('renders nothing when there are no imports', () => {
		const { container } = render(
			<GitHubImportActivity imports={[]} isError={false} isLoading={false} />
		)

		expect(container.firstChild).toBeNull()
	})

	test('renders a row for each in-progress and terminal status', () => {
		render(
			<GitHubImportActivity
				imports={[
					getImport({
						id: 'a' as GitHubRepositoryImport['id'],
						status: 'pending',
					}),
					getImport({
						id: 'b' as GitHubRepositoryImport['id'],
						status: 'running',
					}),
					getImport({
						id: 'c' as GitHubRepositoryImport['id'],
						status: 'succeeded',
					}),
					getImport({
						id: 'd' as GitHubRepositoryImport['id'],
						status: 'failed',
					}),
				]}
				isError={false}
				isLoading={false}
			/>
		)

		expect(screen.getByText('Recent imports')).toBeTruthy()
		expect(screen.getByText('Queued')).toBeTruthy()
		expect(screen.getByText('Running')).toBeTruthy()
		expect(screen.getByText('Completed')).toBeTruthy()
		expect(screen.getByText('Failed')).toBeTruthy()
	})

	test('elevates the queued session imports and links the finished state', () => {
		render(
			<GitHubImportActivity
				imports={[
					getImport({
						id: 'older' as GitHubRepositoryImport['id'],
						targetSlug: 'older' as GitHubRepositoryImport['targetSlug'],
						status: 'succeeded',
					}),
					getImport({
						id: 'queued-a' as GitHubRepositoryImport['id'],
						targetSlug: 'queued-a' as GitHubRepositoryImport['targetSlug'],
						status: 'succeeded',
						repositoryId:
							'b2c3d4e5-f6a7-4890-9abc-1234567890ab' as GitHubRepositoryImport['repositoryId'],
					}),
					getImport({
						id: 'queued-b' as GitHubRepositoryImport['id'],
						targetSlug: 'queued-b' as GitHubRepositoryImport['targetSlug'],
						status: 'failed',
					}),
				]}
				isError={false}
				isLoading={false}
				queuedImportIds={['queued-a', 'queued-b']}
				username="mnigos"
			/>
		)

		expect(screen.getByText('Import progress')).toBeTruthy()
		expect(
			screen.getByText('All imports finished — some need a retry.')
		).toBeTruthy()
		expect(
			screen
				.getByRole('link', { name: 'View all your repositories' })
				.getAttribute('href')
		).toBe('/profile/mnigos')
		expect(screen.getAllByText(TARGET_LABEL_PATTERN)[0]?.textContent).toBe(
			'Target: queued-a'
		)
	})

	test('highlights the row that already has an active import', () => {
		const { container } = render(
			<GitHubImportActivity
				conflictSourceGithubIds={['1']}
				imports={[getImport()]}
				isError={false}
				isLoading={false}
			/>
		)

		expect(
			container.querySelector('[data-github-import-source="1"]')?.className
		).toContain('ring-primary/40')
		expect(
			screen.getByText(
				'This GitHub repository is already importing — follow its progress here.'
			)
		).toBeTruthy()
	})

	test('surfaces the completion link for succeeded imports with an owner', () => {
		render(
			<GitHubImportActivity
				imports={[
					getImport({
						status: 'succeeded',
						repositoryId:
							'b2c3d4e5-f6a7-4890-9abc-1234567890ab' as GitHubRepositoryImport['repositoryId'],
					}),
				]}
				isError={false}
				isLoading={false}
				username="mnigos"
			/>
		)

		expect(
			screen.getByRole('link', { name: 'Open repository' }).getAttribute('href')
		).toBe('/mnigos/tessera')
	})

	test('caps the list at the five most recent imports', () => {
		render(
			<GitHubImportActivity
				imports={Array.from({ length: 7 }, (_, index) =>
					getImport({
						id: `import-${index}` as GitHubRepositoryImport['id'],
						targetSlug: `repo-${index}` as GitHubRepositoryImport['targetSlug'],
					})
				)}
				isError={false}
				isLoading={false}
			/>
		)

		expect(screen.getAllByText(TARGET_LABEL_PATTERN)).toHaveLength(5)
		expect(screen.getByText('Target: repo-0')).toBeTruthy()
		expect(screen.getByText('Target: repo-4')).toBeTruthy()
		expect(screen.queryByText('Target: repo-5')).toBeNull()
	})
})
