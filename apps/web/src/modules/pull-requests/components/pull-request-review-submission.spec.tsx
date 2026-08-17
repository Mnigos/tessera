import { ORPCError } from '@orpc/client'
import type {
	PullRequestPendingReview,
	PullRequestReviewOutcome,
} from '@repo/contracts'
import {
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
	PULL_REQUEST_STALE_COMPARISON_MESSAGE,
} from '@repo/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSubmitPullRequestReviewMutation } from '../hooks/use-submit-pull-request-review.mutation'
import { PullRequestPendingReviewBanner } from './pull-request-pending-review-banner'
import { PullRequestReviewChangesAction } from './pull-request-review-changes-action'
import { PullRequestReviewDialog } from './pull-request-review-dialog'

vi.mock('../hooks/use-submit-pull-request-review.mutation', () => ({
	useSubmitPullRequestReviewMutation: vi.fn(),
}))

vi.mock('../hooks/use-discard-pull-request-review.mutation', () => ({
	useDiscardPullRequestReviewMutation: () => IDLE_MUTATION,
}))

const IDLE_MUTATION = {
	error: undefined,
	isError: false,
	isPending: false,
	mutate: vi.fn(),
	reset: vi.fn(),
}

const useSubmitReviewMutationMock = vi.mocked(
	useSubmitPullRequestReviewMutation
)

const CLOSED_PULL_REQUEST_REGEX = /no longer open/
const BATCHED_COMMENTS_REGEX = /2 comments are batched/
const CANNOT_REVIEW_REGEX = /can no longer review/
const PENDING_COMMENTS_REGEX = /pending comments/
const APPROVE_REGEX = /Approve/
const COMMENT_REGEX = /Comment/
const REQUEST_CHANGES_REGEX = /Request changes/
const AUTHOR_OUTCOME_REASON =
	'You can comment on your own pull request, but not approve or block it.'
const REVIEWED_HEAD_SHA = 'a'.repeat(40)
const MOVED_HEAD_SHA = 'b'.repeat(40)
const pendingReview: PullRequestPendingReview = {
	id: '00000000-0000-4000-8000-000000000053' as PullRequestPendingReview['id'],
	headSha: REVIEWED_HEAD_SHA,
	commentCount: 2,
}
const ALL_REVIEW_OUTCOMES: PullRequestReviewOutcome[] = [
	'comment',
	'approve',
	'request_changes',
]
const repositoryProps = {
	username: 'marta',
	slug: 'notes',
	number: '1',
}
const reviewProps = {
	...repositoryProps,
	allowedOutcomes: ALL_REVIEW_OUTCOMES,
}

describe('pull request review submission', () => {
	const mutate = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		useSubmitReviewMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as unknown as ReturnType<typeof useSubmitPullRequestReviewMutation>)
	})

	test('submits the head the viewer was reading when the dialog opened', async () => {
		const user = userEvent.setup()
		const { rerender } = render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))

		// A background refetch lands while the dialog is open.
		rerender(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={MOVED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)
		const submitButton = screen.getByRole('button', {
			name: 'Submit review',
		})
		fireEvent.submit(submitButton.closest('form') ?? submitButton)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ expectedHeadSha: REVIEWED_HEAD_SHA }),
			expect.anything()
		)
	})

	test.each([
		['Approve', 'approve'],
		['Request changes', 'request_changes'],
		['Comment', 'comment'],
	] as const)('submits the selected %s outcome and trimmed body', async (label, outcome) => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }))
		await user.type(screen.getByLabelText('Review summary'), '  Looks good  ')
		const submitButton = screen.getByRole('button', { name: 'Submit review' })
		fireEvent.submit(submitButton.closest('form') ?? submitButton)

		expect(mutate).toHaveBeenCalledWith(
			{
				...repositoryProps,
				outcome,
				body: 'Looks good',
				expectedHeadSha: REVIEWED_HEAD_SHA,
			},
			expect.anything()
		)
	})

	test('keeps author-only outcomes visible, disabled, and explained', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...repositoryProps}
				allowedOutcomes={['comment']}
				headSha={REVIEWED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		const comment = screen.getByRole<HTMLInputElement>('radio', {
			name: COMMENT_REGEX,
		})
		const approve = screen.getByRole<HTMLInputElement>('radio', {
			name: APPROVE_REGEX,
		})
		const requestChanges = screen.getByRole<HTMLInputElement>('radio', {
			name: REQUEST_CHANGES_REGEX,
		})

		expect(screen.getAllByRole('radio')).toHaveLength(3)
		expect(comment.disabled).toBeFalsy()
		expect(approve.disabled).toBeTruthy()
		expect(requestChanges.disabled).toBeTruthy()
		expect(screen.getByText(AUTHOR_OUTCOME_REASON)).toBeTruthy()

		const tooltipTrigger = approve.closest('label')?.parentElement
		if (!tooltipTrigger) throw new Error('Disabled outcome tooltip missing')
		expect(tooltipTrigger.tabIndex).toBe(0)
		await user.tab()
		expect(document.activeElement).toBe(tooltipTrigger)
		await waitFor(() =>
			expect(screen.getAllByText(AUTHOR_OUTCOME_REASON)).toHaveLength(2)
		)
	})

	test('renders no review trigger when the server allows no outcomes', () => {
		render(
			<PullRequestReviewChangesAction
				headSha={REVIEWED_HEAD_SHA}
				isGitHubAuthoritative={false}
				number="1"
				slug="notes"
				username="marta"
				viewer={{
					allowedOutcomes: [],
					canRequestReviewers: false,
					canRemoveReviewerRequests: false,
				}}
			/>
		)

		expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull()
	})

	test.each([
		['Comment', GITHUB_WRITE_REJECTED_MESSAGES.review_body_required],
		['Request changes', GITHUB_WRITE_REJECTED_MESSAGES.review_body_required],
	] as const)('requires body copy before a mirrored %s review', async (label, hint) => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				isGitHubAuthoritative
				pendingCommentCount={2}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }))

		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Submit review',
			}).disabled
		).toBeTruthy()
		expect(screen.getByText(hint)).toBeTruthy()
		expect(screen.queryByText(PENDING_COMMENTS_REGEX)).toBeNull()
	})

	test('submits a bodyless mirrored approval', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				isGitHubAuthoritative
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		fireEvent.click(screen.getByRole('radio', { name: APPROVE_REGEX }))
		const submitButton = screen.getByRole('button', { name: 'Submit review' })
		fireEvent.submit(submitButton.closest('form') ?? submitButton)

		expect(mutate).toHaveBeenCalledWith(
			{
				...repositoryProps,
				outcome: 'approve',
				body: undefined,
				expectedHeadSha: REVIEWED_HEAD_SHA,
			},
			expect.anything()
		)
	})

	test.each([
		['Comment', 'comment'],
		['Approve', 'approve'],
		['Request changes', 'request_changes'],
	] as const)('keeps body optional for a native %s review', async (label, outcome) => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }))
		const submitButton = screen.getByRole('button', { name: 'Submit review' })
		fireEvent.submit(submitButton.closest('form') ?? submitButton)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome, body: undefined }),
			expect.anything()
		)
	})

	test('prevents resubmitting a delivered mirrored review until its draft changes', async () => {
		const user = userEvent.setup()
		const dialog = () => (
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				isGitHubAuthoritative
				triggerLabel="Review changes"
			/>
		)
		const { rerender } = render(dialog())

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		await user.type(screen.getByLabelText('Review summary'), 'Review note')
		const submitButton = screen.getByRole('button', { name: 'Submit review' })
		fireEvent.submit(submitButton.closest('form') ?? submitButton)

		useSubmitReviewMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate,
		} as unknown as ReturnType<typeof useSubmitPullRequestReviewMutation>)
		rerender(dialog())

		expect(screen.getByRole('status').textContent).toBe(
			GITHUB_SYNC_DELAYED_MESSAGE
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Submit review',
			}).disabled
		).toBeTruthy()

		fireEvent.click(screen.getByRole('radio', { name: APPROVE_REGEX }))

		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Submit review',
			}).disabled
		).toBeFalsy()

		fireEvent.click(screen.getByRole('radio', { name: COMMENT_REGEX }))
		await user.type(screen.getByLabelText('Review summary'), '!')

		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Submit review',
			}).disabled
		).toBeFalsy()
		const nextSubmitButton = screen.getByRole('button', {
			name: 'Submit review',
		})
		fireEvent.submit(nextSubmitButton.closest('form') ?? nextSubmitButton)
		expect(mutate).toHaveBeenCalledTimes(2)
	})

	test('shows reconnect recovery and the review fallback', async () => {
		useSubmitReviewMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('UNAUTHORIZED', {
				status: 401,
				message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
			}),
			isError: true,
			mutate,
		} as unknown as ReturnType<typeof useSubmitPullRequestReviewMutation>)
		const user = userEvent.setup()
		const dialog = () => (
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				isGitHubAuthoritative
				triggerLabel="Review changes"
			/>
		)
		const { rerender } = render(dialog())

		await user.click(screen.getByRole('button', { name: 'Review changes' }))
		expect(
			screen.getByRole('button', { name: 'Reconnect GitHub' })
		).toBeTruthy()

		useSubmitReviewMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('INTERNAL_SERVER_ERROR', {
				status: 500,
				message: 'Internal detail',
			}),
			isError: true,
			mutate,
		} as unknown as ReturnType<typeof useSubmitPullRequestReviewMutation>)
		rerender(dialog())

		expect(screen.getByText('The review could not be submitted.')).toBeTruthy()
	})

	test.each([
		[502, 'BAD_GATEWAY', GITHUB_UNAVAILABLE_MESSAGE, 'alert'],
		[409, 'CONFLICT', PULL_REQUEST_STALE_COMPARISON_MESSAGE, 'alert'],
		[409, 'CONFLICT', GITHUB_SYNC_DELAYED_MESSAGE, 'status'],
	] as const)('surfaces the TES-80 %s review failure copy', async (status, code, message, role) => {
		useSubmitReviewMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError(code, { status, message }),
			isError: true,
			mutate,
		} as unknown as ReturnType<typeof useSubmitPullRequestReviewMutation>)
		const user = userEvent.setup()
		render(
			<PullRequestReviewDialog
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				triggerLabel="Review changes"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Review changes' }))

		expect(screen.getByRole(role).textContent).toBe(message)
	})

	test('disables the trigger and shows why when the comparison is unavailable', () => {
		render(
			<PullRequestReviewDialog {...reviewProps} triggerLabel="Review changes" />
		)

		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Review changes' })
				.disabled
		).toBeTruthy()
		expect(
			screen.getByText('The comparison for this review is unavailable.')
		).toBeTruthy()
	})

	test('offers submit and discard while the viewer can still review', () => {
		render(
			<PullRequestPendingReviewBanner
				{...reviewProps}
				headSha={REVIEWED_HEAD_SHA}
				isOpen
				pendingReview={pendingReview}
			/>
		)

		expect(screen.getByRole('button', { name: 'Submit review' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
		expect(screen.getByText(BATCHED_COMMENTS_REGEX)).toBeTruthy()
	})

	test('passes author outcomes into the pending review dialog', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestPendingReviewBanner
				{...repositoryProps}
				allowedOutcomes={['comment']}
				headSha={REVIEWED_HEAD_SHA}
				isOpen
				pendingReview={pendingReview}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Submit review' }))

		expect(
			screen.getByRole<HTMLInputElement>('radio', { name: APPROVE_REGEX })
				.disabled
		).toBeTruthy()
		expect(
			screen.getByRole<HTMLInputElement>('radio', { name: COMMENT_REGEX })
				.disabled
		).toBeFalsy()
	})

	test('explains capability loss on an open pull request without actions', () => {
		render(
			<PullRequestPendingReviewBanner
				{...reviewProps}
				allowedOutcomes={[]}
				headSha={REVIEWED_HEAD_SHA}
				isOpen
				pendingReview={pendingReview}
			/>
		)

		expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
		expect(screen.getByText(CANNOT_REVIEW_REGEX)).toBeTruthy()
	})

	test('explains a retained pending review instead of offering actions that fail', () => {
		render(
			<PullRequestPendingReviewBanner
				{...reviewProps}
				allowedOutcomes={[]}
				headSha={REVIEWED_HEAD_SHA}
				isOpen={false}
				pendingReview={pendingReview}
			/>
		)

		expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
		expect(
			screen.getByText(CLOSED_PULL_REQUEST_REGEX, { exact: false })
		).toBeTruthy()
	})
})
