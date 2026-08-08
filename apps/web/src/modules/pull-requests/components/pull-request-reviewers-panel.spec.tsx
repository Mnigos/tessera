import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRemovePullRequestReviewerRequestMutation } from '../hooks/use-remove-pull-request-reviewer-request.mutation'
import { useRequestPullRequestReviewerMutation } from '../hooks/use-request-pull-request-reviewer.mutation'
import { PullRequestReviewersPanel } from './pull-request-reviewers-panel'

vi.mock('../hooks/use-remove-pull-request-reviewer-request.mutation', () => ({
	useRemovePullRequestReviewerRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-request-pull-request-reviewer.mutation', () => ({
	useRequestPullRequestReviewerMutation: vi.fn(),
}))

vi.mock('../hooks/use-submit-pull-request-review.mutation', () => ({
	useSubmitPullRequestReviewMutation: () => IDLE_MUTATION,
}))

const IDLE_MUTATION = {
	error: undefined,
	isError: false,
	isPending: false,
	mutate: vi.fn(),
	reset: vi.fn(),
	variables: undefined,
}

const useRemoveReviewerMutationMock = vi.mocked(
	useRemovePullRequestReviewerRequestMutation
)
const useRequestReviewerMutationMock = vi.mocked(
	useRequestPullRequestReviewerMutation
)
const createdAt = new Date('2026-08-08T10:00:00.000Z')
const repositoryProps = { username: 'marta', slug: 'notes', number: '1' }
const FULL_VIEWER: PullRequestReviewViewer = {
	canSubmitReview: true,
	canRequestReviewers: true,
	canRemoveReviewerRequests: true,
}

function actor(username: string): PullRequestReviewerRequest['reviewer'] {
	return { key: `tessera:${username}`, provider: 'tessera', username }
}

function request(reviewerUsername: string): PullRequestReviewerRequest {
	return {
		id: crypto.randomUUID() as PullRequestReviewerRequest['id'],
		targetKind: 'user',
		reviewer: actor(reviewerUsername),
		requestedBy: actor('marta'),
		createdAt,
	}
}

function state(
	reviewerUsername: string,
	outcome: PullRequestEffectiveReviewState['outcome'],
	stale = false
): PullRequestEffectiveReviewState {
	return {
		reviewId:
			crypto.randomUUID() as PullRequestEffectiveReviewState['reviewId'],
		reviewer: actor(reviewerUsername),
		outcome,
		headSha: 'a'.repeat(40),
		stale,
		submittedAt: createdAt,
	}
}

describe(PullRequestReviewersPanel.name, () => {
	const removeMutate = vi.fn()
	const requestMutate = vi.fn()

	beforeEach(() => {
		useRemoveReviewerMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: removeMutate,
		} as never)
		useRequestReviewerMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: requestMutate,
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('renders requested and submitted reviewer states including stale reviews', () => {
		render(
			<PullRequestReviewersPanel
				{...repositoryProps}
				effectiveReviewStates={[
					state('approved-user', 'approve'),
					state('changes-user', 'request_changes', true),
					state('commented-user', 'comment'),
				]}
				headSha={'a'.repeat(40)}
				isOpen
				reviewerCandidates={[]}
				reviewerRequests={[request('requested-user')]}
				viewer={{ ...FULL_VIEWER, canRequestReviewers: false }}
			/>
		)

		expect(screen.getByText('Awaiting review')).toBeTruthy()
		expect(screen.getByText('Approved')).toBeTruthy()
		expect(screen.getByText('Changes requested')).toBeTruthy()
		expect(screen.getByText('Commented')).toBeTruthy()
		expect(screen.getByText('Stale')).toBeTruthy()
	})

	test('submits the exact typed username and removes a requested reviewer', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewersPanel
				{...repositoryProps}
				effectiveReviewStates={[]}
				headSha={'a'.repeat(40)}
				isOpen
				reviewerCandidates={[]}
				reviewerRequests={[request('jan')]}
				viewer={FULL_VIEWER}
			/>
		)

		await user.type(screen.getByLabelText('Request a review'), 'Exact.User-7')
		const requestButton = screen.getByRole('button', { name: 'Request review' })
		fireEvent.submit(requestButton.closest('form') ?? requestButton)
		await user.click(
			screen.getByRole('button', { name: 'Remove review request for jan' })
		)

		expect(requestMutate).toHaveBeenCalledWith(
			{ ...repositoryProps, reviewerUsername: 'Exact.User-7' },
			expect.anything()
		)
		expect(removeMutate).toHaveBeenCalledWith({
			...repositoryProps,
			reviewerUsername: 'jan',
		})
	})

	test('hides request, remove, and review controls without capabilities', () => {
		render(
			<PullRequestReviewersPanel
				{...repositoryProps}
				effectiveReviewStates={[]}
				isOpen
				reviewerCandidates={[]}
				reviewerRequests={[request('jan')]}
				viewer={{
					canSubmitReview: false,
					canRequestReviewers: false,
					canRemoveReviewerRequests: false,
				}}
			/>
		)

		expect(screen.queryByLabelText('Request a review')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Remove review request for jan' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull()
	})
})
