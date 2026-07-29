import { ORPCError } from '@orpc/client'
import type {
	PullRequestComparison,
	RepositoryBranchRef,
} from '@repo/contracts'
import { pullRequestSchema } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useClosePullRequestMutation } from '../hooks/use-close-pull-request.mutation'
import { useEditPullRequestMutation } from '../hooks/use-edit-pull-request.mutation'
import { useMergePullRequestMutation } from '../hooks/use-merge-pull-request.mutation'
import { usePullRequestQuery } from '../hooks/use-pull-request.query'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { useReopenPullRequestMutation } from '../hooks/use-reopen-pull-request.mutation'
import { CreatePullRequestForm } from './create-pull-request-form'
import { PullRequestDetail } from './pull-request-detail'
import { PullRequestEditForm } from './pull-request-edit-form'
import { PullRequestListItem } from './pull-request-list-item'
import { PullRequestMergePanel } from './pull-request-merge-panel'

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

vi.mock('../hooks/use-close-pull-request.mutation', () => ({
	useClosePullRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-edit-pull-request.mutation', () => ({
	useEditPullRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-comparison.query', () => ({
	usePullRequestComparisonQuery: vi.fn(),
}))

vi.mock('../hooks/use-reopen-pull-request.mutation', () => ({
	useReopenPullRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-merge-pull-request.mutation', () => ({
	useMergePullRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-pull-request.query', () => ({
	usePullRequestQuery: vi.fn(),
}))

const useClosePullRequestMutationMock = vi.mocked(useClosePullRequestMutation)
const useEditPullRequestMutationMock = vi.mocked(useEditPullRequestMutation)
const useMergePullRequestMutationMock = vi.mocked(useMergePullRequestMutation)
const usePullRequestComparisonQueryMock = vi.mocked(
	usePullRequestComparisonQuery
)
const usePullRequestQueryMock = vi.mocked(usePullRequestQuery)
const useReopenPullRequestMutationMock = vi.mocked(useReopenPullRequestMutation)

const PULL_REQUEST = pullRequestSchema.parse({
	id: 'd8101d74-b320-4482-a8f2-a25308fb2757',
	repositoryId: '8426d960-d537-4bc9-9ec9-43e8acd632b0',
	provider: 'tessera',
	number: 1,
	authorUserId: '479a0ef2-aed6-48cd-9511-bb39a86a3ba5',
	authorUsername: 'marta',
	sourceBranch: 'feature/pull-request-review',
	targetBranch: 'main',
	openingBaseSha: 'a'.repeat(40),
	openingHeadSha: 'b'.repeat(40),
	title: 'Review pull request UI',
	body: '',
	state: 'open',
	createdAt: new Date('2026-07-11T10:00:00.000Z'),
	updatedAt: new Date('2026-07-11T10:00:00.000Z'),
})

const COMPARISON = {
	baseSha: 'a'.repeat(40),
	headSha: 'b'.repeat(40),
	mergeBaseSha: 'a'.repeat(40),
	commits: [],
	files: [],
	isTruncated: false,
	commitsTruncated: false,
	commitLimit: 500,
	fileLimit: 300,
} satisfies PullRequestComparison

const BRANCHES = [
	{
		type: 'branch',
		name: 'main',
		qualifiedName: 'refs/heads/main',
		target: 'a'.repeat(40),
	},
	{
		type: 'branch',
		name: 'feature/pull-request-review',
		qualifiedName: 'refs/heads/feature/pull-request-review',
		target: 'b'.repeat(40),
	},
] satisfies RepositoryBranchRef[]

describe('pull request review findings', () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('announces create failures and associates them with the form', () => {
		const { container } = render(
			<CreatePullRequestForm
				branches={BRANCHES}
				defaultBranch="main"
				errorMessage="The pull request could not be created."
				isPending={false}
				onSubmit={vi.fn()}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByRole('alert').textContent).toContain(
			'The pull request could not be created.'
		)
		expect(
			container.querySelector('form')?.getAttribute('aria-describedby')
		).toBe('pull-request-create-error')
	})

	test('shows a visible error for a whitespace-only edited title', () => {
		useEditPullRequestMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			mutate: vi.fn(),
		} as never)
		render(
			<PullRequestEditForm
				onDone={vi.fn()}
				pullRequest={PULL_REQUEST}
				slug="notes"
				username="marta"
			/>
		)

		const titleInput = screen.getByLabelText('Title')
		const form = titleInput.closest('form')
		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.change(titleInput, { target: { value: '   ' } })
		fireEvent.submit(form)

		expect(screen.getByRole('alert').textContent).toContain(
			'Title must contain at least one non-space character.'
		)
		expect(titleInput.getAttribute('aria-invalid')).toBe('true')
	})

	test('keeps merge disabled while the comparison is in an error state', async () => {
		const mutate = vi.fn()
		useMergePullRequestMutationMock.mockReturnValue({
			error: undefined,
			isError: false,
			isPending: false,
			mutate,
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestMergePanel
				comparison={COMPARISON}
				isComparisonError
				isComparisonLoading={false}
				onRefreshComparison={vi.fn()}
				pullRequest={PULL_REQUEST}
				slug="notes"
				username="marta"
			/>
		)

		const mergeButton = screen.getByRole('button', {
			name: 'Merge pull request',
		})
		expect(mergeButton.hasAttribute('disabled')).toBeTruthy()
		await user.click(mergeButton)
		expect(mutate).not.toHaveBeenCalled()
	})

	test('refreshes the comparison automatically after a stale merge', async () => {
		const onRefreshComparison = vi.fn()
		useMergePullRequestMutationMock.mockReturnValue({
			error: undefined,
			isError: false,
			isPending: false,
			mutate: vi.fn((_input, options) => {
				options?.onError?.(
					new ORPCError('CONFLICT', {
						message:
							'The source or target branch changed. Refresh the pull request and try again.',
					}),
					_input,
					undefined
				)
			}),
		} as never)
		const user = userEvent.setup()
		render(
			<PullRequestMergePanel
				comparison={COMPARISON}
				isComparisonError={false}
				isComparisonLoading={false}
				onRefreshComparison={onRefreshComparison}
				pullRequest={PULL_REQUEST}
				slug="notes"
				username="marta"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Merge pull request' }))

		expect(onRefreshComparison).toHaveBeenCalledOnce()
	})

	test('distinguishes not found from generic detail query failures', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: undefined,
			error: new ORPCError('NOT_FOUND'),
			isError: true,
			isLoading: false,
		} as never)

		const { rerender } = render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByText('Pull request not found')).toBeTruthy()

		usePullRequestQueryMock.mockReturnValue({
			data: undefined,
			error: new Error('network unavailable'),
			isError: true,
			isLoading: false,
		} as never)
		rerender(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByText('Pull request could not be loaded')).toBeTruthy()
	})

	test('shows edit, lifecycle, and merge controls for write-role viewers', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: { pullRequest: PULL_REQUEST, events: [], viewerRole: 'write' },
			isError: false,
			isLoading: false,
		} as never)
		usePullRequestComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as never)
		useMergePullRequestMutationMock.mockReturnValue({
			error: undefined,
			isError: false,
			isPending: false,
			mutate: vi.fn(),
		} as never)
		useClosePullRequestMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			mutate: vi.fn(),
		} as never)
		useReopenPullRequestMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			mutate: vi.fn(),
		} as never)

		render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Close pull request' })
		).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Merge pull request' })
		).toBeTruthy()
	})

	test('hides edit, lifecycle, and merge controls for read-only viewers', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: { pullRequest: PULL_REQUEST, events: [], viewerRole: 'read' },
			isError: false,
			isLoading: false,
		} as never)
		usePullRequestComparisonQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as never)
		render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByText('Review pull request UI')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Close pull request' })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Merge pull request' })
		).toBeNull()
	})

	test('renders safe Markdown and exposes the current detail page', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: {
				pullRequest: {
					...PULL_REQUEST,
					body: '## Summary\n\n- Safe item\n\n<script>unsafe()</script>',
				},
				events: [],
				viewerRole: 'read',
			},
			isError: false,
			isLoading: false,
		} as never)

		const { container } = render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy()
		expect(screen.getByText('Safe item').closest('li')).toBeTruthy()
		expect(
			screen
				.getByRole('link', { name: 'Overview' })
				.getAttribute('aria-current')
		).toBe('page')
		expect(container.querySelector('script')).toBeNull()
	})

	test('preserves full long branch names as accessible titles', () => {
		const sourceBranch = `feature/${'source-segment-'.repeat(20)}`
		const targetBranch = `release/${'target-segment-'.repeat(20)}`

		render(
			<PullRequestListItem
				pullRequest={{ ...PULL_REQUEST, sourceBranch, targetBranch }}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByTitle(sourceBranch)).toBeTruthy()
		expect(screen.getByTitle(targetBranch)).toBeTruthy()
	})
})
