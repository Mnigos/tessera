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
		expect(screen.getByText('pending')).toBeTruthy()
		expect(screen.getByText('running')).toBeTruthy()
		expect(screen.getByText('succeeded')).toBeTruthy()
		expect(screen.getByText('failed')).toBeTruthy()
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
			screen.getByRole('link', { name: 'Open' }).getAttribute('href')
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
