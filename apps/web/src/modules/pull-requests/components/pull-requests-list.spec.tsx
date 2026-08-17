import { pullRequestListItemSchema } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { usePullRequestsListQuery } from '../hooks/use-pull-requests-list.query'
import { PullRequestsList } from './pull-requests-list'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params?: { number?: string }
		to: string
	}) => (
		<a data-route-number={params?.number} href={to} {...props}>
			{children}
		</a>
	),
}))

vi.mock('../hooks/use-pull-requests-list.query', () => ({
	usePullRequestsListQuery: vi.fn(),
}))

const usePullRequestsListQueryMock = vi.mocked(usePullRequestsListQuery)
const CHANGES_BADGE_REGEX = /requested changes/
const STALE_BADGE_REGEX = /stale/
const ANY_REVIEW_BADGE_REGEX =
	/approved|requested changes|awaiting review|stale/
const DEFAULT_SEARCH = {
	state: 'all',
	sort: 'created',
	direction: 'desc',
} as const
const LIST_PROPS = {
	onFiltersChange: vi.fn(),
	onPageChange: vi.fn(),
	search: DEFAULT_SEARCH,
	slug: 'notes',
	username: 'marta',
}
const PULL_REQUEST = pullRequestListItemSchema.parse({
	reviewSummary: {
		requestedCount: 1,
		approvedCount: 1,
		changeRequestCount: 0,
		staleCount: 0,
	},
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
			selectedState: 'all' as const,
		}
		const { rerender } = render(<PullRequestsList {...props} />)
		expect(document.querySelector('.animate-pulse')).toBeTruthy()

		usePullRequestsListQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)
		rerender(<PullRequestsList {...LIST_PROPS} />)
		expect(screen.getByText('Pull requests could not be loaded')).toBeTruthy()

		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [], hasAnyPullRequests: true, viewerRole: 'read' },
			isLoading: false,
			isError: false,
		} as never)
		rerender(<PullRequestsList {...LIST_PROPS} />)
		expect(screen.getByText('No pull requests match')).toBeTruthy()

		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [], hasAnyPullRequests: false, viewerRole: 'read' },
			isLoading: false,
			isError: false,
		} as never)
		rerender(<PullRequestsList {...LIST_PROPS} />)
		expect(screen.getByText('No pull requests yet')).toBeTruthy()
	})

	test('clears every filter from a no-match state', async () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: { pullRequests: [], hasAnyPullRequests: true, viewerRole: 'read' },
			isLoading: false,
			isError: false,
		} as never)
		const onFiltersChange = vi.fn()
		const user = userEvent.setup()
		render(
			<PullRequestsList
				{...LIST_PROPS}
				onFiltersChange={onFiltersChange}
				search={{
					state: 'closed',
					draft: 'only',
					q: 'missing',
					sort: 'activity',
					direction: 'asc',
				}}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Clear filters' }))

		expect(onFiltersChange).toHaveBeenCalledWith({
			state: 'open',
			draft: undefined,
			q: undefined,
			sort: 'created',
			direction: 'desc',
		})
	})

	test('renders metadata, write action, and state filter behavior', async () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				pullRequests: [PULL_REQUEST],
				hasAnyPullRequests: true,
				viewerRole: 'write',
			},
			isLoading: false,
			isError: false,
		} as never)
		const onFiltersChange = vi.fn()
		const user = userEvent.setup()
		render(
			<PullRequestsList
				{...LIST_PROPS}
				onFiltersChange={onFiltersChange}
				search={{ ...DEFAULT_SEARCH, state: 'open' }}
			/>
		)

		expect(screen.getByText('Review pull request list')).toBeTruthy()
		expect(screen.getByText('by marta')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'New pull request' })).toBeTruthy()
		await user.click(screen.getByRole('button', { name: 'Closed' }))
		expect(onFiltersChange).toHaveBeenCalledWith({ state: 'closed' })
	})

	test('hides the new pull request action for read-only viewers', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				pullRequests: [PULL_REQUEST],
				hasAnyPullRequests: true,
				viewerRole: 'read',
			},
			isLoading: false,
			isError: false,
		} as never)
		render(<PullRequestsList {...LIST_PROPS} />)

		expect(screen.queryByRole('link', { name: 'New pull request' })).toBeNull()
	})

	test('hides the new pull request action on a writable GitHub mirror', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				authority: 'github',
				pullRequests: [PULL_REQUEST],
				hasAnyPullRequests: true,
				viewerRole: 'write',
			},
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestsList
				onSelectedStateChange={vi.fn()}
				selectedState="all"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.queryByRole('link', { name: 'New pull request' })).toBeNull()
	})

	test('renders non-zero review summary badges and omits zero counts', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				pullRequests: [PULL_REQUEST],
				hasAnyPullRequests: true,
				viewerRole: 'read',
			},
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestsList
				onSelectedStateChange={vi.fn()}
				selectedState="all"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByTitle('1 approved')).toBeTruthy()
		expect(screen.getByTitle('1 awaiting review')).toBeTruthy()
		expect(screen.queryByTitle(CHANGES_BADGE_REGEX)).toBeNull()
		expect(screen.queryByTitle(STALE_BADGE_REGEX)).toBeNull()
	})

	test('renders no review badges for a zero summary', () => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				pullRequests: [
					{
						...PULL_REQUEST,
						reviewSummary: {
							requestedCount: 0,
							approvedCount: 0,
							changeRequestCount: 0,
							staleCount: 0,
						},
					},
				],
				hasAnyPullRequests: true,
				viewerRole: 'read',
			},
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestsList
				onSelectedStateChange={vi.fn()}
				selectedState="all"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.queryByTitle(ANY_REVIEW_BADGE_REGEX)).toBeNull()
	})

	test.each([
		[1, '1 file'],
		[3, '3 files'],
	] as const)('renders GitHub text and diff stats for %i changed files while routing locally', (changedFiles, filesLabel) => {
		usePullRequestsListQueryMock.mockReturnValue({
			data: {
				pullRequests: [
					{
						...PULL_REQUEST,
						diffStats: { additions: 12, deletions: 4, changedFiles },
						github: {
							nodeId: 'PR_kwDOExample',
							htmlUrl: 'https://github.com/marta/notes/pull/77',
							draft: false,
							headSha: 'b'.repeat(40),
							baseSha: 'a'.repeat(40),
							externalNumber: 77,
						},
					},
				],
				hasAnyPullRequests: true,
				viewerRole: 'read',
			},
			isLoading: false,
			isError: false,
		} as never)

		render(<PullRequestsList {...LIST_PROPS} />)

		expect(screen.getByText('#77')).toBeTruthy()
		expect(screen.getByText(filesLabel)).toBeTruthy()
		expect(screen.getByText('+12')).toBeTruthy()
		expect(screen.getByText('−4')).toBeTruthy()
		expect(
			screen
				.getByRole('link', { name: 'Review pull request list' })
				.getAttribute('data-route-number')
		).toBe('1')
	})
})
