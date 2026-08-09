import type {
	MergePullRequestResult,
	MergeQueueStatus,
	MergeRequirements,
	PullRequest,
} from '@repo/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const MERGE_BUTTON = { name: 'Merge pull request' }
const BLOCKED_HEADING_REGEX = /cannot be merged yet/
const APPROVALS_REGEX = /1 of 2 required approvals/
const STALE_APPROVAL_REGEX = /no longer counts because the branch moved/
const THREADS_REGEX = /2 comment threads are unresolved/
const CHANGES_REQUESTED_REGEX = /requested changes/
const QUEUE_POSITION_REGEX = /number 2 in line/
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

const eligibleRequirements: MergeRequirements = {
	eligible: true,
	canBypass: false,
	evaluatedBaseSha: BASE_SHA,
	evaluatedHeadSha: HEAD_SHA,
	reasons: [],
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
	submittedAt = MERGE_SUBMITTED_AT,
}: {
	answer?: MergePullRequestResult
	data?: MergePullRequestResult
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
		isError: false,
		error: null,
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

function renderPanel(mergeQueue: MergeQueueStatus = { runnableCount: 0 }) {
	render(
		<PullRequestMergePanel
			mergeQueue={mergeQueue}
			pullRequest={pullRequest}
			slug="notes"
			username="marta"
		/>
	)
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
				mergeQueue={{ runnableCount: 0 }}
				pullRequest={{ ...pullRequest, state: 'merged' }}
				slug="notes"
				username="marta"
			/>
		)

		expect(container.textContent).toBe('')
	})
})
