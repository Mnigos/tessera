import { ORPCError } from '@orpc/client'
import type {
	MergePullRequestResult,
	MergeQueueStatus,
	MergeRequirements,
	PullRequest,
} from '@repo/contracts'
import {
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
} from '@repo/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useJoinMergeQueueMutation } from '../hooks/use-join-merge-queue.mutation'
import { useLeaveMergeQueueMutation } from '../hooks/use-leave-merge-queue.mutation'
import { useMergePullRequestMutation } from '../hooks/use-merge-pull-request.mutation'
import { usePullRequestMergeRequirementsQuery } from '../hooks/use-pull-request-merge-requirements.query'
import { useRetryMergeQueueEntryMutation } from '../hooks/use-retry-merge-queue-entry.mutation'
import { PullRequestMergePanel } from './pull-request-merge-panel'

vi.mock('../hooks/use-merge-pull-request.mutation', () => ({
	useMergePullRequestMutation: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-merge-requirements.query', () => ({
	usePullRequestMergeRequirementsQuery: vi.fn(),
}))

vi.mock('../hooks/use-join-merge-queue.mutation', () => ({
	useJoinMergeQueueMutation: vi.fn(),
}))

vi.mock('../hooks/use-leave-merge-queue.mutation', () => ({
	useLeaveMergeQueueMutation: vi.fn(),
}))

vi.mock('../hooks/use-retry-merge-queue-entry.mutation', () => ({
	useRetryMergeQueueEntryMutation: vi.fn(),
}))

const useMergeMutationMock = vi.mocked(useMergePullRequestMutation)
const useRequirementsQueryMock = vi.mocked(usePullRequestMergeRequirementsQuery)
const useJoinMutationMock = vi.mocked(useJoinMergeQueueMutation)
const useLeaveMutationMock = vi.mocked(useLeaveMergeQueueMutation)
const useRetryMutationMock = vi.mocked(useRetryMergeQueueEntryMutation)

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MERGE_BUTTON = { name: 'Merge commit' }
const BLOCKED_HEADING_REGEX = /cannot be merged yet/
const APPROVALS_REGEX = /1 of 2 required approvals/
const STALE_APPROVAL_REGEX = /no longer counts because the branch moved/
const THREADS_REGEX = /2 comment threads are unresolved/
const CHANGES_REQUESTED_REGEX = /requested changes/
const QUEUE_POSITION_REGEX = /number 2 in line/
const FAST_FORWARD_OPTION_REGEX = /Fast-forward/
const REBASE_OPTION_REGEX = /Rebase and merge/
const QUEUED_REBASE_REGEX = /Will merge by rebase and merge/
const createdAt = new Date('2026-08-06T10:00:00Z')

const pullRequest: PullRequest = {
	id: '00000000-0000-4000-8000-000000000044' as PullRequest['id'],
	repositoryId:
		'00000000-0000-4000-8000-000000000002' as PullRequest['repositoryId'],
	provider: 'tessera',
	number: 1,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: BASE_SHA,
	openingHeadSha: HEAD_SHA,
	title: 'Add feature',
	body: '',
	state: 'open',
	createdAt,
	updatedAt: createdAt,
}

const ALL_STRATEGIES_AVAILABLE: MergeRequirements['strategyAvailability'] = [
	{ strategy: 'merge_commit', available: true },
	{ strategy: 'squash', available: true },
	{ strategy: 'rebase', available: true },
	{ strategy: 'fast_forward', available: true },
]

const eligibleRequirements: MergeRequirements = {
	eligible: true,
	canBypass: false,
	evaluatedBaseSha: BASE_SHA,
	evaluatedHeadSha: HEAD_SHA,
	reasons: [],
	strategyAvailability: ALL_STRATEGIES_AVAILABLE,
}

interface MergeMutateOptions {
	onSuccess?: (result: MergePullRequestResult) => void
}

/**
 * When each side of the panel last heard from the server. The two are compared
 * to decide which verdict is the current one, so every mock carries a timestamp
 * and the defaults put the merge attempt after the requirements read.
 */
const REQUIREMENTS_READ_AT = 1000
const MERGE_SUBMITTED_AT = 2000

/**
 * Stands in for the mutation the panel drives. `answer` is handed back through
 * the same callback React Query would, so what the panel does with a result —
 * not just how it renders one — is reachable from a click, while `data` is what
 * the panel is already holding when it renders.
 */
function mockMergeMutation({
	answer,
	data,
	error,
	submittedAt = MERGE_SUBMITTED_AT,
}: {
	answer?: MergePullRequestResult
	data?: MergePullRequestResult
	error?: unknown
	submittedAt?: number
} = {}) {
	const mutate = vi.fn((_input: unknown, options?: MergeMutateOptions) => {
		if (answer) options?.onSuccess?.(answer)
	})

	useMergeMutationMock.mockReturnValue({
		mutate,
		data,
		submittedAt,
		isPending: false,
		isError: Boolean(error),
		error,
	} as unknown as ReturnType<typeof useMergePullRequestMutation>)

	return mutate
}

function mockRequirements(
	requirements: MergeRequirements | undefined = eligibleRequirements,
	overrides: {
		dataUpdatedAt?: number
		isError?: boolean
		isLoading?: boolean
	} = {}
) {
	const refetch = vi.fn()

	useRequirementsQueryMock.mockReturnValue({
		data: requirements,
		dataUpdatedAt: overrides.dataUpdatedAt ?? REQUIREMENTS_READ_AT,
		error: null,
		isError: overrides.isError ?? false,
		isLoading: overrides.isLoading ?? false,
		refetch,
	} as unknown as ReturnType<typeof usePullRequestMergeRequirementsQuery>)

	return refetch
}

function mockQueueMutations() {
	const join = vi.fn()
	const leave = vi.fn()
	const retry = vi.fn()

	useJoinMutationMock.mockReturnValue({
		mutate: join,
		isPending: false,
		isError: false,
		error: null,
	} as never)
	useLeaveMutationMock.mockReturnValue({
		mutate: leave,
		isPending: false,
		isError: false,
		error: null,
	} as never)
	useRetryMutationMock.mockReturnValue({
		mutate: retry,
		isPending: false,
		isError: false,
		error: null,
	} as never)

	return { join, leave, retry }
}

function panelElement(
	mergeQueue: MergeQueueStatus,
	isGitHubAuthoritative = false
) {
	return (
		<PullRequestMergePanel
			isGitHubAuthoritative={isGitHubAuthoritative}
			mergeQueue={mergeQueue}
			pullRequest={pullRequest}
			slug="notes"
			username="marta"
		/>
	)
}

/**
 * A render the test can drive a second time, for the case where the server's
 * answer changes under a selection the reader already made.
 */
function renderPanelForRerender(
	mergeQueue: MergeQueueStatus = { runnableCount: 0 },
	isGitHubAuthoritative = false
) {
	const view = render(panelElement(mergeQueue, isGitHubAuthoritative))

	return {
		rerender: (nextIsGitHubAuthoritative = isGitHubAuthoritative) =>
			view.rerender(panelElement(mergeQueue, nextIsGitHubAuthoritative)),
	}
}

function renderPanel(
	mergeQueue: MergeQueueStatus = { runnableCount: 0 },
	isGitHubAuthoritative = false
) {
	render(
		<PullRequestMergePanel
			isGitHubAuthoritative={isGitHubAuthoritative}
			mergeQueue={mergeQueue}
			pullRequest={pullRequest}
			slug="notes"
			username="marta"
		/>
	)
}

describe('GitHub-authoritative merge panel', () => {
	beforeEach(() => {
		mockQueueMutations()
	})

	afterEach(() => vi.resetAllMocks())

	test('offers only direct GitHub merge methods and ownership copy', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			strategyAvailability: undefined,
		})
		renderPanel({ runnableCount: 2 }, true)

		await user.click(screen.getByRole('combobox', { name: 'Merge method' }))
		const options = screen.getAllByRole('option')

		expect(options).toHaveLength(3)
		expect(within(options[0]).getByText('Merge commit')).toBeTruthy()
		expect(within(options[1]).getByText('Squash and merge')).toBeTruthy()
		expect(within(options[2]).getByText('Rebase and merge')).toBeTruthy()
		expect(screen.queryByText(FAST_FORWARD_OPTION_REGEX)).toBeNull()
		expect(screen.queryByRole('heading', { name: 'Merge queue' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Join merge queue' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Merge anyway' })).toBeNull()
		expect(
			screen.queryByText('Everything this branch requires is satisfied.')
		).toBeNull()
		expect(
			screen.getByText(
				'GitHub performs the merge and applies its own branch protection.'
			)
		).toBeTruthy()
	})

	test('merges by squash without collecting a Tessera commit message', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			strategyAvailability: undefined,
		})
		renderPanel({ runnableCount: 0 }, true)

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Squash and merge' }))

		expect(screen.queryByRole('dialog')).toBeNull()
		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'squash' }),
			expect.anything()
		)
	})

	test('explains a mirrored pull request that has no GitHub mapping', () => {
		mockMergeMutation()
		mockRequirements({
			eligible: true,
			canBypass: false,
			reasons: [],
		})
		renderPanel({ runnableCount: 0 }, true)

		expect(
			screen.getByText(GITHUB_WRITE_REJECTED_MESSAGES.missing_mapping)
		).toBeTruthy()
		expect(screen.queryByRole('button', MERGE_BUTTON)).toBeNull()
	})

	test('renders GitHub blocking reasons without a bypass action', () => {
		mockMergeMutation()
		mockRequirements({
			eligible: false,
			canBypass: true,
			reasons: [
				{
					code: 'insufficient_permission',
					requiredRole: 'write',
					actualRole: 'read',
				},
				{ code: 'pull_request_not_open', state: 'closed' },
			],
		})
		renderPanel({ runnableCount: 0 }, true)

		expect(
			screen.getByText('You need write access to this repository to merge.')
		).toBeTruthy()
		expect(screen.getByText('This pull request is closed.')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Merge anyway' })).toBeNull()
	})

	test('drops a native fast-forward selection when authority changes', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements()
		const { rerender } = renderPanelForRerender()

		await chooseStrategy(user, 'Fast-forward')
		expect(screen.getByRole('button', { name: 'Fast-forward' })).toBeTruthy()

		rerender(true)

		expect(screen.getByRole('button', { name: 'Merge commit' })).toBeTruthy()
	})

	test('surfaces reconnect recovery and the merge fallback', () => {
		mockRequirements()
		mockMergeMutation({
			error: new ORPCError('UNAUTHORIZED', {
				status: 401,
				message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
			}),
		})
		const { rerender } = renderPanelForRerender({ runnableCount: 0 }, true)

		expect(
			screen.getByRole('button', { name: 'Reconnect GitHub' })
		).toBeTruthy()

		mockMergeMutation({
			error: new ORPCError('INTERNAL_SERVER_ERROR', {
				status: 500,
				message: 'Internal detail',
			}),
		})
		rerender()

		expect(
			screen.getByText('The pull request could not be merged.')
		).toBeTruthy()
	})
})

/** Picks a merge method through the select the panel renders. */
async function chooseStrategy(user: UserEvent, name: string) {
	await user.click(screen.getByRole('combobox', { name: 'Merge method' }))
	await user.click(screen.getByRole('option', { name: new RegExp(name) }))
}

describe(PullRequestMergePanel.name, () => {
	beforeEach(() => {
		mockQueueMutations()
	})

	afterEach(() => vi.resetAllMocks())

	test('offers the merge once the server reports nothing against it', () => {
		mockMergeMutation()
		mockRequirements()
		renderPanel()

		expect(screen.getByRole('button', MERGE_BUTTON)).toBeTruthy()
		expect(screen.queryByText(BLOCKED_HEADING_REGEX)).toBeNull()
	})

	// The refs merged are the ones the evaluation resolved, never a pair the
	// client assembled from a diff it read separately.
	test('merges the refs the requirements were evaluated against', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			evaluatedBaseSha: 'c'.repeat(40),
			evaluatedHeadSha: 'd'.repeat(40),
		})
		renderPanel()

		await user.click(screen.getByRole('button', MERGE_BUTTON))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBaseSha: 'c'.repeat(40),
				expectedHeadSha: 'd'.repeat(40),
				bypass: undefined,
			}),
			expect.anything()
		)
	})

	test('lists every requirement standing in the way', () => {
		mockMergeMutation()
		mockRequirements({
			eligible: false,
			canBypass: false,
			evaluatedBaseSha: BASE_SHA,
			evaluatedHeadSha: HEAD_SHA,
			reasons: [
				{
					code: 'approvals_required',
					required: 2,
					approved: 1,
					staleApprovals: 1,
				},
				{ code: 'threads_unresolved', count: 2 },
			],
		})
		renderPanel()

		expect(screen.getByText(BLOCKED_HEADING_REGEX)).toBeTruthy()
		expect(screen.getByText(APPROVALS_REGEX)).toBeTruthy()
		expect(screen.getByText(STALE_APPROVAL_REGEX)).toBeTruthy()
		expect(screen.getByText(THREADS_REGEX)).toBeTruthy()
		expect(screen.queryByRole('button', MERGE_BUTTON)).toBeNull()
	})

	// The waiver is only offered where the server said the role and the blockers
	// allow it, so the affordance never appears on a refusal nothing can waive.
	test('offers no waiver when the server did not grant one', () => {
		mockMergeMutation()
		mockRequirements({
			eligible: false,
			canBypass: false,
			reasons: [{ code: 'threads_unresolved', count: 2 }],
		})
		renderPanel()

		expect(screen.queryByRole('button', { name: 'Merge anyway' })).toBeNull()
	})

	test('sends the waiver reason with the merge it excuses', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements({
			eligible: false,
			canBypass: true,
			evaluatedBaseSha: BASE_SHA,
			evaluatedHeadSha: HEAD_SHA,
			reasons: [{ code: 'threads_unresolved', count: 2 }],
		})
		renderPanel()

		await user.click(screen.getByRole('button', { name: 'Merge anyway' }))
		await user.type(screen.getByLabelText('Reason'), '  Production incident  ')
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'Merge anyway',
			})
		)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ bypass: { reason: 'Production incident' } }),
			expect.anything()
		)
	})

	// The panel offered refs that have since moved, so the next attempt would send
	// the same stale pair again unless the verdict is re-read.
	test('re-reads the requirements when the refs it sent had moved on', async () => {
		const user = userEvent.setup()
		mockMergeMutation({
			answer: {
				status: 'blocked',
				requirements: {
					eligible: false,
					canBypass: false,
					evaluatedBaseSha: BASE_SHA,
					evaluatedHeadSha: HEAD_SHA,
					reasons: [
						{
							code: 'stale_refs',
							expectedBaseSha: BASE_SHA,
							actualBaseSha: 'c'.repeat(40),
							expectedHeadSha: HEAD_SHA,
							actualHeadSha: 'd'.repeat(40),
						},
					],
				},
			},
		})
		const refetch = mockRequirements()
		renderPanel()

		await user.click(screen.getByRole('button', MERGE_BUTTON))

		expect(refetch).toHaveBeenCalledOnce()
	})

	test('leaves the requirements alone when the refusal was about something else', async () => {
		const user = userEvent.setup()
		mockMergeMutation({
			answer: {
				status: 'blocked',
				requirements: {
					eligible: false,
					canBypass: false,
					reasons: [{ code: 'threads_unresolved', count: 2 }],
				},
			},
		})
		const refetch = mockRequirements()
		renderPanel()

		await user.click(screen.getByRole('button', MERGE_BUTTON))

		expect(refetch).not.toHaveBeenCalled()
	})

	// A refusal the merge attempt returned is fresher than the one the panel was
	// showing, so it replaces it rather than being shown beside it.
	test('shows the refusal the merge attempt came back with', () => {
		mockMergeMutation({
			data: {
				status: 'blocked',
				requirements: {
					eligible: false,
					canBypass: false,
					reasons: [{ code: 'changes_requested', reviewers: [] }],
				},
			},
		})
		mockRequirements()
		renderPanel()

		expect(screen.getByText(CHANGES_REQUESTED_REGEX)).toBeTruthy()
		expect(screen.queryByRole('button', MERGE_BUTTON)).toBeNull()
	})

	// The refusal describes the moment the merge was attempted. Once the query has
	// answered from after that moment, it is describing a later world — the one
	// where the blockers were resolved — and holding on to the refusal would show
	// a wall the server no longer puts up.
	test('lets a requirements read from after the attempt replace the refusal', () => {
		mockMergeMutation({
			data: {
				status: 'blocked',
				requirements: {
					eligible: false,
					canBypass: false,
					reasons: [{ code: 'changes_requested', reviewers: [] }],
				},
			},
			submittedAt: 2000,
		})
		mockRequirements(eligibleRequirements, { dataUpdatedAt: 3000 })
		renderPanel()

		expect(screen.getByRole('button', MERGE_BUTTON)).toBeTruthy()
		expect(screen.queryByText(CHANGES_REQUESTED_REGEX)).toBeNull()
	})

	test('reports requirements it could not read, and offers to try again', () => {
		mockMergeMutation()
		mockRequirements(undefined, { isError: true })
		renderPanel()

		expect(screen.getByRole('alert')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
		expect(screen.queryByRole('button', MERGE_BUTTON)).toBeNull()
	})

	test('offers to join a queue this pull request is not in', async () => {
		const user = userEvent.setup()
		const { join } = mockQueueMutations()
		mockMergeMutation()
		mockRequirements()
		renderPanel({ runnableCount: 3 })

		await user.click(screen.getByRole('button', { name: 'Join merge queue' }))

		expect(join).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes',
			number: 1,
			strategy: 'merge_commit',
		})
	})

	test('shows where a queued pull request stands and offers to leave', () => {
		mockMergeMutation()
		mockRequirements()
		renderPanel({
			runnableCount: 4,
			entry: {
				entryId: '00000000-0000-4000-8000-000000000066' as never,
				state: 'queued',
				strategy: 'merge_commit',
				position: 2,
				enqueuedAt: createdAt,
				stateChangedAt: createdAt,
			},
		})

		expect(screen.getByText(QUEUE_POSITION_REGEX)).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Leave queue' })).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: 'Join merge queue' })
		).toBeNull()
	})

	// Git has the branch by the time an entry is merging, and the server refuses
	// to withdraw it from under that. Offering the button would only be a way to
	// be told no.
	test('offers no way out of the queue while the entry is being merged', () => {
		mockMergeMutation()
		mockRequirements()
		renderPanel({
			runnableCount: 2,
			entry: {
				entryId: '00000000-0000-4000-8000-000000000066' as never,
				state: 'merging',
				strategy: 'merge_commit',
				position: 1,
				enqueuedAt: createdAt,
				stateChangedAt: createdAt,
			},
		})

		expect(screen.queryByRole('button', { name: 'Leave queue' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Join merge queue' })
		).toBeNull()
	})

	// A paused entry keeps its place in the list but not in the line, and retrying
	// is the only thing that sends it back to the queue.
	test('offers a retry for a paused entry, with what paused it', async () => {
		const user = userEvent.setup()
		const { retry } = mockQueueMutations()
		mockMergeMutation()
		mockRequirements()
		renderPanel({
			runnableCount: 1,
			entry: {
				entryId: '00000000-0000-4000-8000-000000000066' as never,
				state: 'paused',
				strategy: 'merge_commit',
				blockingReasons: [{ code: 'threads_unresolved', count: 2 }],
				enqueuedAt: createdAt,
				stateChangedAt: createdAt,
			},
		})

		expect(screen.getByText('Paused')).toBeTruthy()
		expect(screen.getAllByText(THREADS_REGEX).length).toBeGreaterThan(0)

		await user.click(screen.getByRole('button', { name: 'Retry' }))

		expect(retry).toHaveBeenCalledOnce()
	})

	test('renders nothing for a pull request that is no longer open', () => {
		mockMergeMutation()
		mockRequirements()
		const { container } = render(
			<PullRequestMergePanel
				isGitHubAuthoritative={false}
				mergeQueue={{ runnableCount: 0 }}
				pullRequest={{ ...pullRequest, state: 'merged' }}
				slug="notes"
				username="marta"
			/>
		)

		expect(container.textContent).toBe('')
	})
})

describe('choosing a merge method', () => {
	beforeEach(() => {
		mockQueueMutations()
	})

	afterEach(() => vi.resetAllMocks())

	test('starts on the merge commit every repository can take', () => {
		mockMergeMutation()
		mockRequirements()
		renderPanel()

		expect(screen.getByRole('button', { name: 'Merge commit' })).toBeTruthy()
		expect(
			screen.getByText('Create a two-parent merge commit on main.')
		).toBeTruthy()
	})

	test('merges by the method the reader picked', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements()
		renderPanel()

		await chooseStrategy(user, 'Rebase and merge')
		await user.click(screen.getByRole('button', { name: 'Rebase and merge' }))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'rebase' }),
			expect.anything()
		)
	})

	// A method that cannot run stays on the list and says why, because a reader
	// who cannot find fast-forward has no idea what happened to it.
	test('keeps an unavailable method visible with its reason', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			strategyAvailability: [
				{ strategy: 'merge_commit', available: true },
				{ strategy: 'squash', available: true },
				{ strategy: 'rebase', available: false, reason: 'nothing_to_rebase' },
				{
					strategy: 'fast_forward',
					available: false,
					reason: 'not_fast_forward',
				},
			],
		})
		renderPanel()

		await user.click(screen.getByRole('combobox', { name: 'Merge method' }))
		const fastForward = screen.getByRole('option', {
			name: FAST_FORWARD_OPTION_REGEX,
		})

		expect(
			within(fastForward).getByText('The branches have diverged.')
		).toBeTruthy()
		expect(
			within(
				screen.getByRole('option', { name: REBASE_OPTION_REGEX })
			).getByText('There is nothing left to replay.')
		).toBeTruthy()
		expect(fastForward.getAttribute('data-disabled')).not.toBeNull()
	})

	// A refreshed availability that contradicts the selection gives way on the
	// next render rather than leaving a button that is certain to be refused.
	test('falls back to an available method when the branches move', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements()
		const { rerender } = renderPanelForRerender()

		await chooseStrategy(user, 'Fast-forward')
		expect(screen.getByRole('button', { name: 'Fast-forward' })).toBeTruthy()

		mockRequirements({
			...eligibleRequirements,
			strategyAvailability: [
				{ strategy: 'merge_commit', available: true },
				{ strategy: 'squash', available: true },
				{ strategy: 'rebase', available: true },
				{
					strategy: 'fast_forward',
					available: false,
					reason: 'not_fast_forward',
				},
			],
		})
		rerender()

		await user.click(screen.getByRole('button', { name: 'Merge commit' }))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'merge_commit' }),
			expect.anything()
		)
	})

	// The squash commit is the only record of this work the target branch keeps,
	// so its message is confirmed rather than assumed.
	test('asks for the squash message before merging', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements()
		renderPanel()

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Squash and merge' }))

		const title = screen.getByLabelText('Title')
		expect((title as HTMLInputElement).value).toBe('Add feature (#1)')

		await user.clear(title)
		await user.type(title, 'A better title')
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'Squash and merge',
			})
		)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'squash',
				squashTitle: 'A better title',
			}),
			expect.anything()
		)
	})

	// Closing on confirm would hide the merge while it was still running, so the
	// "Merging" state the reader is waiting on would never appear.
	test('keeps the squash dialog open while the merge runs', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements()
		const { rerender } = renderPanelForRerender()

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Squash and merge' }))
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'Squash and merge',
			})
		)

		// The merge is now in flight.
		useMergeMutationMock.mockReturnValue({
			mutate: vi.fn(),
			data: undefined,
			submittedAt: MERGE_SUBMITTED_AT,
			isPending: true,
			isError: false,
			error: null,
		} as unknown as ReturnType<typeof useMergePullRequestMutation>)
		rerender()

		expect(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'Merging',
			})
		).toBeTruthy()
	})

	// A merge that failed needs the message back exactly as it was left, not
	// reset to the pull request's own title.
	test('keeps the edited squash message when the merge fails', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation({
			answer: {
				status: 'blocked',
				requirements: { ...eligibleRequirements, eligible: false },
			},
		})
		mockRequirements()
		renderPanel()

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Squash and merge' }))

		const dialog = screen.getByRole('dialog')
		const title = within(dialog).getByLabelText('Title')

		await user.clear(title)
		await user.type(title, 'A better title')
		await user.click(
			within(dialog).getByRole('button', { name: 'Squash and merge' })
		)

		expect(mutate).toHaveBeenCalled()
		// Still open, still holding what was typed.
		expect(
			(
				within(screen.getByRole('dialog')).getByLabelText(
					'Title'
				) as HTMLInputElement
			).value
		).toBe('A better title')
	})

	// One decision, one dialog: waiving policy and writing the commit message the
	// waiver produces are the same act, and splitting them would let a reader
	// waive a requirement without ever seeing the commit it is for.
	test('asks for the squash message and the waiver together', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			eligible: false,
			canBypass: true,
			reasons: [
				{
					code: 'approvals_required',
					required: 2,
					approved: 1,
					staleApprovals: 0,
				},
			],
		})
		renderPanel()

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Merge anyway' }))

		const dialog = screen.getByRole('dialog')
		const title = within(dialog).getByLabelText('Title')

		expect((title as HTMLInputElement).value).toBe('Add feature (#1)')

		await user.clear(title)
		await user.type(title, 'A better title')
		await user.type(
			within(dialog).getByLabelText('Reason for the waiver'),
			'The release cannot wait.'
		)
		await user.click(
			within(dialog).getByRole('button', { name: 'Squash and merge' })
		)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'squash',
				squashTitle: 'A better title',
				bypass: { reason: 'The release cannot wait.' },
			}),
			expect.anything()
		)
	})

	test('carries the chosen method through the bypass dialog', async () => {
		const user = userEvent.setup()
		const mutate = mockMergeMutation()
		mockRequirements({
			...eligibleRequirements,
			eligible: false,
			canBypass: true,
			reasons: [
				{
					code: 'approvals_required',
					required: 2,
					approved: 1,
					staleApprovals: 0,
				},
			],
		})
		renderPanel()

		await chooseStrategy(user, 'Rebase and merge')
		await user.click(screen.getByRole('button', { name: 'Merge anyway' }))
		await user.type(screen.getByLabelText('Reason'), 'The release cannot wait.')
		await user.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'Merge anyway',
			})
		)

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'rebase',
				bypass: { reason: 'The release cannot wait.' },
			}),
			expect.anything()
		)
	})

	test('joins the queue with the method the reader picked', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements()
		const { join } = mockQueueMutations()
		renderPanel({ runnableCount: 2 })

		await chooseStrategy(user, 'Rebase and merge')
		await user.click(screen.getByRole('button', { name: 'Join merge queue' }))

		expect(join).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'rebase' })
		)
	})

	// The queue settles the message when the entry is created and never derives
	// it again, so a queued squash has to be as configurable as a direct one.
	test('collects the squash message before joining the queue', async () => {
		const user = userEvent.setup()
		mockMergeMutation()
		mockRequirements()
		const { join } = mockQueueMutations()
		renderPanel({ runnableCount: 2 })

		await chooseStrategy(user, 'Squash and merge')
		await user.click(screen.getByRole('button', { name: 'Join merge queue' }))

		const dialog = screen.getByRole('dialog')
		const title = within(dialog).getByLabelText('Title')

		expect((title as HTMLInputElement).value).toBe('Add feature (#1)')

		await user.clear(title)
		await user.type(title, 'Queued title')
		await user.click(
			within(dialog).getByRole('button', { name: 'Squash and merge' })
		)

		expect(join).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'squash',
				squashTitle: 'Queued title',
			})
		)
	})

	// The method was settled when the entry was created and the queue never
	// re-chooses it, so it is reported rather than offered.
	test('reports the method a queued entry will merge by', () => {
		mockMergeMutation()
		mockRequirements()
		renderPanel({
			runnableCount: 2,
			entry: {
				entryId: '00000000-0000-4000-8000-000000000066' as never,
				state: 'queued',
				strategy: 'rebase',
				position: 2,
				enqueuedAt: createdAt,
				stateChangedAt: createdAt,
			},
		})

		expect(screen.getByText(QUEUED_REBASE_REGEX)).toBeTruthy()
	})
})
