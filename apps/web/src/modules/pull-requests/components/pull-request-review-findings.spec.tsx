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
import { usePullRequestMergeRequirementsQuery } from '../hooks/use-pull-request-merge-requirements.query'
import { useReopenPullRequestMutation } from '../hooks/use-reopen-pull-request.mutation'
import { CreatePullRequestForm } from './create-pull-request-form'
import { PullRequestDetail } from './pull-request-detail'
import { PullRequestEditForm } from './pull-request-edit-form'
import { PullRequestListItem } from './pull-request-list-item'

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

vi.mock('../hooks/use-pull-request-merge-requirements.query', () => ({
	usePullRequestMergeRequirementsQuery: vi.fn(),
}))

vi.mock('../hooks/use-join-merge-queue.mutation', () => ({
	useJoinMergeQueueMutation: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('../hooks/use-leave-merge-queue.mutation', () => ({
	useLeaveMergeQueueMutation: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('../hooks/use-retry-merge-queue-entry.mutation', () => ({
	useRetryMergeQueueEntryMutation: () => ({
		isPending: false,
		mutate: vi.fn(),
	}),
}))

vi.mock('../hooks/use-pull-request.query', () => ({
	usePullRequestQuery: vi.fn(),
}))

vi.mock('@/modules/auth/hooks/use-auth', () => ({
	useAuth: () => ({ user: undefined }),
}))

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: () => ({
		data: undefined,
		isLoading: false,
		isError: false,
	}),
}))

vi.mock('../hooks/use-pull-request-checks.query', () => ({
	usePullRequestChecksQuery: () => ({
		data: undefined,
		isLoading: false,
		isError: false,
	}),
}))

vi.mock('@/modules/repositories/hooks/use-repository-refs.query', () => ({
	useRepositoryRefsQuery: () => ({ data: undefined, isError: false }),
}))

vi.mock('../hooks/use-retarget-pull-request.mutation', () => ({
	useRetargetPullRequestMutation: () => ({
		isError: false,
		isPending: false,
		mutate: vi.fn(),
		reset: vi.fn(),
	}),
}))

const useClosePullRequestMutationMock = vi.mocked(useClosePullRequestMutation)
const useEditPullRequestMutationMock = vi.mocked(useEditPullRequestMutation)
const useMergePullRequestMutationMock = vi.mocked(useMergePullRequestMutation)
const usePullRequestComparisonQueryMock = vi.mocked(
	usePullRequestComparisonQuery
)
const usePullRequestMergeRequirementsQueryMock = vi.mocked(
	usePullRequestMergeRequirementsQuery
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

const REVIEW_SUMMARY = {
	requestedCount: 0,
	approvedCount: 0,
	changeRequestCount: 0,
	staleCount: 0,
}

const REVIEW_VIEWER = {
	canSubmitReview: false,
	canRequestReviewers: false,
	canRemoveReviewerRequests: false,
}

function detailData(overrides: Record<string, unknown> = {}) {
	return {
		pullRequest: PULL_REQUEST,
		events: [],
		reviewerRequests: [],
		reviews: [],
		effectiveReviewStates: [],
		reviewerCandidates: [],
		viewer: REVIEW_VIEWER,
		viewerRole: 'read',
		mergeQueue: { runnableCount: 0 },
		...overrides,
	}
}

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

	// The description is a controlled field inside the Write panel now, so the
	// edit still has to carry what the pull request was already saying plus
	// whatever was typed on top of it.
	test('edits the description through the write and preview editor', async () => {
		const mutate = vi.fn()
		useEditPullRequestMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			mutate,
		} as never)
		const user = userEvent.setup()
		const { container } = render(
			<PullRequestEditForm
				onDone={vi.fn()}
				pullRequest={{ ...PULL_REQUEST, body: 'Original body' }}
				slug="notes"
				username="marta"
			/>
		)

		await user.click(screen.getByRole('tab', { name: 'Preview' }))
		expect(screen.getByRole('tabpanel').textContent).toBe('Original body')

		await user.click(screen.getByRole('tab', { name: 'Write' }))
		await user.type(screen.getByLabelText('Description'), ' extended')

		const form = container.querySelector('form')
		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ body: 'Original body extended' }),
			expect.anything()
		)
	})

	// Enough of the write-side surface for the detail header to render: the
	// lifecycle buttons and merge panel come with it and read their own mutations.
	function primeWriteControls() {
		usePullRequestComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as never)
		usePullRequestMergeRequirementsQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as never)
		for (const mutation of [
			useMergePullRequestMutationMock,
			useClosePullRequestMutationMock,
			useReopenPullRequestMutationMock,
		])
			mutation.mockReturnValue({
				error: undefined,
				isError: false,
				isPending: false,
				mutate: vi.fn(),
			} as never)
	}

	// The affordance moves a branch, which is a write on an open pull request. A
	// closed one has nowhere to move to, and a repository GitHub owns is not
	// Tessera's to move — the server refuses both, and the UI must not offer them.
	test.each([
		[
			'a closed pull request',
			{
				viewerRole: 'write',
				pullRequest: { ...PULL_REQUEST, state: 'closed' },
			},
		],
		[
			'a GitHub-authoritative repository',
			{ viewerRole: 'write', authority: 'github' },
		],
		['a read-only viewer', { viewerRole: 'read' }],
	])('hides the retarget affordance for %s', (_name, overrides) => {
		primeWriteControls()
		usePullRequestQueryMock.mockReturnValue({
			data: detailData(overrides),
			isError: false,
			isLoading: false,
		} as never)

		render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.queryByRole('button', { name: 'Change target' })).toBeNull()
	})

	test('offers the retarget affordance on an open pull request a viewer may write', () => {
		primeWriteControls()
		usePullRequestQueryMock.mockReturnValue({
			data: detailData({ viewerRole: 'write' }),
			isError: false,
			isLoading: false,
		} as never)

		render(
			<PullRequestDetail
				number="1"
				slug="notes"
				tab="overview"
				username="marta"
			/>
		)

		expect(screen.getByRole('button', { name: 'Change target' })).toBeTruthy()
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
			data: detailData({ viewerRole: 'write' }),
			isError: false,
			isLoading: false,
		} as never)
		usePullRequestComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as never)
		usePullRequestMergeRequirementsQueryMock.mockReturnValue({
			data: {
				eligible: true,
				canBypass: false,
				reasons: [],
				evaluatedBaseSha: 'a'.repeat(40),
				evaluatedHeadSha: 'b'.repeat(40),
			},
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
		expect(screen.getByRole('button', { name: 'Merge commit' })).toBeTruthy()
	})

	test('hides edit, lifecycle, and merge controls for read-only viewers', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: detailData(),
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
		expect(screen.queryByRole('button', { name: 'Merge commit' })).toBeNull()
	})

	test('renders safe Markdown and exposes the current detail page', () => {
		usePullRequestQueryMock.mockReturnValue({
			data: detailData({
				pullRequest: {
					...PULL_REQUEST,
					body: '## Summary\n\n- Safe item\n\n<script>unsafe()</script>',
				},
			}),
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
				pullRequest={{
					...PULL_REQUEST,
					sourceBranch,
					targetBranch,
					reviewSummary: REVIEW_SUMMARY,
				}}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByTitle(sourceBranch)).toBeTruthy()
		expect(screen.getByTitle(targetBranch)).toBeTruthy()
	})
})
