import { pullRequestSchema } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { usePullRequestsListQuery } from '../hooks/use-pull-requests-list.query'
import { PullRequestsList } from './pull-requests-list'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		to: string
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))

vi.mock('../hooks/use-pull-requests-list.query', () => ({
	usePullRequestsListQuery: vi.fn(),
}))

const usePullRequestsListQueryMock = vi.mocked(usePullRequestsListQuery)
const PULL_REQUEST = pullRequestSchema.parse({
	id: 'd8101d74-b320-4482-a8f2-a25308fb2757',
	repositoryId: '8426d960-d537-4bc9-9ec9-43e8acd632b0',
	provider: 'tessera',
	number: 1,
	authorUserId: '479a0ef2-aed6-48cd-9511-bb39a86a3ba5',
	authorUsername: 'marta',
	sourceBranch: 'feature/pull-request',
	targetBranch: 'main',
	openingBaseSha: 'a'.repeat(40),
	openingHeadSha: 'b'.repeat(40),
	title: 'Review pull request list',
	body: '',
	state: 'open',
	createdAt: new Date('2026-07-11T10:00:00.000Z'),
	updatedAt: new Date('2026-07-11T10:00:00.000Z'),
})

describe(PullRequestsList.name, () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('renders loading, error, and empty states', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		} as never)
		const props = {
			username: 'marta',
			slug: 'notes',
			onSelectedStateChange: vi.fn(),
		}
		const { rerender } = render(<PullRequestsList {...props} />)
		expect(document.querySelector('.animate-pulse')).toBeTruthy()

		usePullRequestsListQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)
		rerender(<PullRequestsList {...props} />)
		expect(screen.getByText('Pull requests could not be loaded')).toBeTruthy()

		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [], viewerRole: 'read' },
			isLoading: false,
			isError: false,
		} as never)
		rerender(<PullRequestsList {...props} />)
		expect(screen.getByText('No pull requests match this filter.')).toBeTruthy()
	})

	test('renders metadata, write action, and state filter behavior', async () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [PULL_REQUEST], viewerRole: 'write' },
			isLoading: false,
			isError: false,
		} as never)
		const onSelectedStateChange = vi.fn()
		const user = userEvent.setup()
		render(
			<PullRequestsList
				onSelectedStateChange={onSelectedStateChange}
				selectedState="open"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText('Review pull request list')).toBeTruthy()
		expect(screen.getByText('by marta')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'New pull request' })).toBeTruthy()
		await user.click(screen.getByRole('button', { name: 'Closed' }))
		expect(onSelectedStateChange).toHaveBeenCalledWith('closed')
	})

	test('hides the new pull request action for read-only viewers', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [PULL_REQUEST], viewerRole: 'read' },
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestsList
				onSelectedStateChange={vi.fn()}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.queryByRole('link', { name: 'New pull request' })).toBeNull()
	})
})
