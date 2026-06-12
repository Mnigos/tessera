import type { GitHubRepositoryImport } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useRetryGitHubImportMutation } from '../hooks/use-retry-github-import.mutation'
import { GitHubImportActivityRow } from './github-import-activity-row'

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

const RETRY_REGEX = /retry/i

type RetryMutation = ReturnType<typeof useRetryGitHubImportMutation>

function mockRetryMutation(overrides: Partial<RetryMutation> = {}) {
	const mutation = {
		mutate: vi.fn(),
		isPending: false,
		isError: false,
		...overrides,
	} as unknown as RetryMutation

	useRetryGitHubImportMutationMock.mockReturnValue(mutation)

	return mutation
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

describe('GitHubImportActivityRow', () => {
	beforeEach(() => {
		mockRetryMutation()
	})

	test.each([
		'pending',
		'running',
		'succeeded',
		'failed',
	] as const)('renders the %s status badge', status => {
		render(<GitHubImportActivityRow import={getImport({ status })} />)

		expect(screen.getByText(status)).toBeTruthy()
	})

	test('links succeeded imports to the imported repository', () => {
		render(
			<GitHubImportActivityRow
				import={getImport({
					status: 'succeeded',
					repositoryId:
						'b2c3d4e5-f6a7-4890-9abc-1234567890ab' as GitHubRepositoryImport['repositoryId'],
				})}
				username="mnigos"
			/>
		)

		const openLink = screen.getByRole('link', { name: 'Open' })

		expect(openLink.getAttribute('href')).toBe('/mnigos/tessera')
	})

	test('does not link succeeded imports without an owning username', () => {
		render(
			<GitHubImportActivityRow
				import={getImport({
					status: 'succeeded',
					repositoryId:
						'b2c3d4e5-f6a7-4890-9abc-1234567890ab' as GitHubRepositoryImport['repositoryId'],
				})}
			/>
		)

		expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
	})

	test('shows the failure reason on failed imports', () => {
		render(
			<GitHubImportActivityRow
				import={getImport({
					status: 'failed',
					failureReason: 'GitHub repository could not be cloned.',
				})}
			/>
		)

		expect(
			screen.getByText('GitHub repository could not be cloned.')
		).toBeTruthy()
	})

	test('falls back to a default message when no failure reason is present', () => {
		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByText(
				'This import failed for an unknown reason. Retry to try again.'
			)
		).toBeTruthy()
	})

	test.each([
		'pending',
		'running',
		'succeeded',
	] as const)('hides the retry button on %s imports', status => {
		render(<GitHubImportActivityRow import={getImport({ status })} />)

		expect(screen.queryByRole('button', { name: RETRY_REGEX })).toBeNull()
	})

	test('shows the retry button only on failed imports', () => {
		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
	})

	test('retries the failed import on click', () => {
		const mutation = mockRetryMutation()
		const repositoryImport = getImport({ status: 'failed' })

		render(<GitHubImportActivityRow import={repositoryImport} />)
		fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

		expect(mutation.mutate).toHaveBeenCalledWith({ id: repositoryImport.id })
	})

	test('disables the retry button while the retry is in flight', () => {
		mockRetryMutation({ isPending: true })

		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Retrying...' })
				.disabled
		).toBe(true)
	})

	test('surfaces the generic fallback for unknown retry errors', () => {
		mockRetryMutation({
			isError: true,
			error: new Error('Internal Server Error'),
		})

		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByText('Retry could not be queued. Please try again.')
		).toBeTruthy()
	})

	test('surfaces the collision message for a target slug conflict', () => {
		mockRetryMutation({
			isError: true,
			error: new Error('github repository import target slug already exists'),
		})

		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByText('A repository with this target slug already exists.')
		).toBeTruthy()
	})

	test('surfaces the reconnect message for GitHub auth failures', () => {
		mockRetryMutation({
			isError: true,
			error: Object.assign(new Error('github auth required'), {
				code: 'UNAUTHORIZED',
			}),
		})

		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByText(
				'Reconnect GitHub with repository access, then try again.'
			)
		).toBeTruthy()
	})

	test('surfaces the not-retryable message for stale failed imports', () => {
		mockRetryMutation({
			isError: true,
			error: new Error('github repository import is not retryable'),
		})

		render(<GitHubImportActivityRow import={getImport({ status: 'failed' })} />)

		expect(
			screen.getByText(
				'This import is no longer in a failed state. Refresh to see its latest status.'
			)
		).toBeTruthy()
	})
})
