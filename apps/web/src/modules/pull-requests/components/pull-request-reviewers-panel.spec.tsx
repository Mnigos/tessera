import { ORPCError } from '@orpc/client'
import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { GITHUB_SYNC_DELAYED_MESSAGE } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useRemovePullRequestReviewerRequestMutation } from '../hooks/use-remove-pull-request-reviewer-request.mutation'
import { useRequestPullRequestReviewerMutation } from '../hooks/use-request-pull-request-reviewer.mutation'
import { PullRequestReviewersPanel } from './pull-request-reviewers-panel'

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: () => ({ data: undefined, isError: false }),
}))

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		search,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params: Record<string, string>
		search?: { reviewId?: string }
		to: string
	}) => (
		<a data-review-id={search?.reviewId} href={to} {...props}>
			{children}
		</a>
	),
}))

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
const VIEW_CHANGES_SINCE_NAME = /^View changes since/
const createdAt = new Date('2026-08-08T10:00:00.000Z')
const repositoryProps = { username: 'marta', slug: 'notes', number: '1' }
const FULL_VIEWER: PullRequestReviewViewer = {
	allowedOutcomes: ['comment', 'approve', 'request_changes'],
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
		const approved = state('approved-user', 'approve')

		render(
			<PullRequestReviewersPanel
				isGitHubAuthoritative={false}
				{...repositoryProps}
				effectiveReviewStates={[
					approved,
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
		// One entry point per review that exists, staleness being emphasis rather
		// than a gate: a current review still leads to its own explicit answer.
		expect(
			screen
				.getAllByRole('link', { name: VIEW_CHANGES_SINCE_NAME })
				.map(link => link.getAttribute('data-review-id'))
		).toEqual([approved.reviewId, expect.any(String), expect.any(String)])
	})

	test('submits the exact typed username and removes a requested reviewer', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestReviewersPanel
				isGitHubAuthoritative={false}
				{...repositoryProps}
				effectiveReviewStates={[]}
				headSha={'a'.repeat(40)}
				isOpen
				reviewerCandidates={[]}
				reviewerRequests={[request('jan')]}
				viewer={FULL_VIEWER}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Manage reviewers' }))
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

	test('keeps idempotent reviewer requests retryable after delayed synchronization', async () => {
		useRequestReviewerMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate: requestMutate,
		} as never)
		render(
			<PullRequestReviewersPanel
				isGitHubAuthoritative
				{...repositoryProps}
				effectiveReviewStates={[]}
				isOpen
				reviewerCandidates={[
					{
						userId: '00000000-0000-4000-8000-000000000061' as never,
						username: 'jan',
					},
				]}
				reviewerRequests={[]}
				viewer={{ ...FULL_VIEWER, allowedOutcomes: [] }}
			/>
		)

		const user = userEvent.setup()
		await user.click(screen.getByRole('button', { name: 'Manage reviewers' }))

		expect(screen.getByRole('status').textContent).toBe(
			GITHUB_SYNC_DELAYED_MESSAGE
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Request review' })
				.disabled
		).toBeFalsy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'jan' }).disabled
		).toBeFalsy()
		await user.type(screen.getByLabelText('Request a review'), 'anna')
		const requestButton = screen.getByRole('button', { name: 'Request review' })
		fireEvent.submit(requestButton.closest('form') ?? requestButton)
		await user.click(screen.getByRole('button', { name: 'jan' }))
		expect(requestMutate).toHaveBeenNthCalledWith(
			1,
			{ ...repositoryProps, reviewerUsername: 'anna' },
			expect.anything()
		)
		expect(requestMutate).toHaveBeenNthCalledWith(2, {
			...repositoryProps,
			reviewerUsername: 'jan',
		})
	})

	test('hides request, remove, and review controls without capabilities', () => {
		render(
			<PullRequestReviewersPanel
				isGitHubAuthoritative={false}
				{...repositoryProps}
				effectiveReviewStates={[]}
				isOpen
				reviewerCandidates={[]}
				reviewerRequests={[request('jan')]}
				viewer={{
					allowedOutcomes: [],
					canRequestReviewers: false,
					canRemoveReviewerRequests: false,
				}}
			/>
		)

		expect(
			screen.queryByRole('button', { name: 'Manage reviewers' })
		).toBeNull()
		expect(screen.queryByLabelText('Request a review')).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Remove review request for jan' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull()
		// A reviewer who has only been asked has left nothing to compare against.
		expect(
			screen.queryByRole('link', { name: VIEW_CHANGES_SINCE_NAME })
		).toBeNull()
	})
})
