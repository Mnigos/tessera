import type {
	PullRequestChangedFile,
	PullRequestCommentId,
	PullRequestComparison as PullRequestComparisonData,
	PullRequestEvent,
	PullRequestThread,
	PullRequestThreadId,
	PullRequestThreadViewer,
} from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { useResolvePullRequestThreadMutation } from '../hooks/use-resolve-pull-request-thread.mutation'
import { PullRequestComparison } from './pull-request-comparison'
import { PullRequestThreadCard } from './pull-request-thread-card'
import { PullRequestTimeline } from './pull-request-timeline'

vi.mock('../hooks/use-pull-request-comparison.query', () => ({
	usePullRequestComparisonQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-file-diff.query', () => ({
	usePullRequestFileDiffQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: vi.fn(),
}))

vi.mock('../hooks/use-create-pull-request-thread.mutation', () => ({
	useCreatePullRequestThreadMutation: vi.fn(),
}))

vi.mock('../hooks/use-reply-pull-request-thread.mutation', () => ({
	useReplyPullRequestThreadMutation: () => IDLE_MUTATION,
}))

vi.mock('../hooks/use-edit-pull-request-comment.mutation', () => ({
	useEditPullRequestCommentMutation: () => IDLE_MUTATION,
}))

vi.mock('../hooks/use-delete-pull-request-comment.mutation', () => ({
	useDeletePullRequestCommentMutation: () => IDLE_MUTATION,
}))

vi.mock('../hooks/use-resolve-pull-request-thread.mutation', () => ({
	useResolvePullRequestThreadMutation: vi.fn(),
}))

vi.mock('../hooks/use-unresolve-pull-request-thread.mutation', () => ({
	useUnresolvePullRequestThreadMutation: () => IDLE_MUTATION,
}))

const IDLE_MUTATION = {
	error: undefined,
	isError: false,
	isPending: false,
	mutate: vi.fn(),
}

const useComparisonQueryMock = vi.mocked(usePullRequestComparisonQuery)
const useCreateThreadMutationMock = vi.mocked(
	useCreatePullRequestThreadMutation
)
const useFileDiffQueryMock = vi.mocked(usePullRequestFileDiffQuery)
const useThreadsQueryMock = vi.mocked(usePullRequestThreadsQuery)
const useResolveMutationMock = vi.mocked(useResolvePullRequestThreadMutation)

type ThreadAuthorId = PullRequestThread['comments'][number]['authorUserId']

const AUTHOR_USER_ID = '00000000-0000-4000-8000-0000000000a1' as ThreadAuthorId
const createdAt = new Date('2026-08-06T10:00:00.000Z')
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MOVED_HEAD_SHA = 'c'.repeat(40)
const RENAMED_FILE_BUTTON_NAME_REGEX = /src\/old\.ts → src\/new\.ts/
const COMMENTED_EVENT_REGEX = /Pull request commented/
const RESOLVED_EVENT_REGEX = /Comment thread resolved by marta/
const UNRESOLVED_EVENT_REGEX = /Comment thread unresolved by marta/

const FULL_VIEWER: PullRequestThreadViewer = {
	canComment: true,
	canResolveAnyThread: true,
	canDeleteAnyComment: true,
}

const RENAMED_FILE = {
	status: 'renamed',
	oldPath: 'src/old.ts',
	newPath: 'src/new.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	additions: 1,
	deletions: 0,
	isBinary: false,
} satisfies PullRequestChangedFile

const COMPARISON = {
	baseSha: BASE_SHA,
	headSha: HEAD_SHA,
	mergeBaseSha: BASE_SHA,
	commits: [],
	files: [RENAMED_FILE],
	isTruncated: false,
	commitsTruncated: false,
	commitLimit: 500,
	fileLimit: 300,
} satisfies PullRequestComparisonData

function thread({
	id,
	path,
	body,
	resolved,
}: {
	id: string
	path?: string
	body: string
	resolved?: boolean
}): PullRequestThread {
	return {
		id: id as PullRequestThreadId,
		kind: path ? 'inline' : 'top_level',
		anchor: path
			? {
					path,
					side: 'left',
					line: 1,
					anchorSha: BASE_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const removed = 1',
				}
			: undefined,
		resolved: resolved
			? {
					at: createdAt,
					byUserId: AUTHOR_USER_ID,
					byUsername: 'marta',
				}
			: undefined,
		outdated: false,
		createdAt,
		comments: [
			{
				id: `${id}-comment` as PullRequestCommentId,
				threadId: id as PullRequestThreadId,
				authorUserId: AUTHOR_USER_ID,
				authorUsername: 'marta',
				body,
				state: 'published',
				createdAt,
			},
		],
	}
}

const FILE_DIFF = {
	data: {
		baseSha: BASE_SHA,
		headSha: HEAD_SHA,
		mergeBaseSha: BASE_SHA,
		file: RENAMED_FILE,
		language: 'typescript',
		hunks: [
			{
				header: '@@ -1 +1 @@',
				lines: [
					{
						kind: 'deletion',
						content: 'const removed = 1',
						old: { sha: BASE_SHA, path: 'src/old.ts', line: 1, side: 'left' },
					},
				],
			},
		],
		isTruncated: false,
		patchLimitBytes: 2_097_152,
	},
	isLoading: false,
	isError: false,
}

describe('pull request threads', () => {
	beforeEach(() => {
		useCreateThreadMutationMock.mockReturnValue(IDLE_MUTATION as never)
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue(FILE_DIFF as never)
		useResolveMutationMock.mockReturnValue(IDLE_MUTATION as never)
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	test('fetches threads once for the whole pull request and keeps left-side threads on a renamed file', async () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [
					thread({
						id: '00000000-0000-4000-8000-000000000001',
						path: 'src/old.ts',
						body: 'Anchored to the pre-rename path',
					}),
				],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		expect(useThreadsQueryMock).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes',
			number: '1',
		})
		expect(useThreadsQueryMock).toHaveBeenCalledTimes(1)
		await user.click(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		)
		expect(screen.getByText('Anchored to the pre-rename path')).toBeTruthy()
	})

	test('collects threads no file can display under outdated discussions', () => {
		const vanishedThread = thread({
			id: '00000000-0000-4000-8000-000000000002',
			path: 'src/vanished.ts',
			body: 'Anchored to a file outside the comparison',
		})
		vanishedThread.outdated = true
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [
					vanishedThread,
					thread({
						id: '00000000-0000-4000-8000-000000000003',
						body: 'Top level comment',
					}),
				],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		expect(screen.getByText('Outdated discussions (1)')).toBeTruthy()
		expect(screen.getByText('src/vanished.ts:1')).toBeTruthy()
		expect(screen.getByText('Outdated')).toBeTruthy()
		expect(screen.queryByText('Top level comment')).toBeNull()
	})

	test('shows a matched-file thread under its file card when the diff has no hunks', async () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [
					thread({
						id: '00000000-0000-4000-8000-000000000014',
						path: 'src/old.ts',
						body: 'Discussion with no rendered hunk',
					}),
				],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue({
			...FILE_DIFF,
			data: { ...FILE_DIFF.data, hunks: [] },
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		expect(screen.queryByText('Outdated discussions (1)')).toBeNull()
		await user.click(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		)
		expect(screen.getByText('No text changes to display.')).toBeTruthy()
		expect(screen.getByText('Comments (1)')).toBeTruthy()
		expect(screen.getByText('Discussion with no rendered hunk')).toBeTruthy()
	})

	test.each([
		['without a session', undefined],
		['for a GitHub-authoritative pull request', AUTHOR_USER_ID],
	])('withholds line composers %s', async (_context, viewerUserId) => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: {
					canComment: false,
					canResolveAnyThread: false,
					canDeleteAnyComment: false,
				},
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
				viewerUserId={viewerUserId}
			/>
		)

		await user.click(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		)

		expect(
			screen.queryByRole('button', { name: 'Comment on original line 1' })
		).toBeNull()
	})

	test('submits exact left deletion and right addition anchors from split gutters', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue({
			...FILE_DIFF,
			data: {
				...FILE_DIFF.data,
				hunks: [
					{
						header: '@@ -4 +9 @@',
						lines: [
							{
								kind: 'deletion',
								content: 'x'.repeat(5000),
								old: {
									sha: BASE_SHA,
									path: 'src/old.ts',
									line: 4,
									side: 'left',
								},
							},
							{
								kind: 'addition',
								content: 'const added = true',
								new: {
									sha: HEAD_SHA,
									path: 'src/new.ts',
									line: 9,
									side: 'right',
								},
							},
						],
					},
				],
			},
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		await user.click(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		)
		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 4' })
		)
		const leftComposer = screen.getByRole('textbox', {
			name: 'Comment on line 4',
		})
		fireEvent.change(leftComposer, { target: { value: 'Left note' } })
		fireEvent.submit(leftComposer.closest('form') ?? leftComposer)

		expect(mutate).toHaveBeenLastCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				body: 'Left note',
				anchor: {
					path: 'src/old.ts',
					side: 'left',
					line: 4,
					anchorSha: BASE_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'x'.repeat(4096),
				},
			},
			expect.any(Object)
		)

		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		await user.click(
			screen.getByRole('button', { name: 'Comment on updated line 9' })
		)
		const rightComposer = screen.getByRole('textbox', {
			name: 'Comment on line 9',
		})
		fireEvent.change(rightComposer, { target: { value: 'Right note' } })
		fireEvent.submit(rightComposer.closest('form') ?? rightComposer)
		expect(mutate).toHaveBeenLastCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				body: 'Right note',
				anchor: {
					path: 'src/new.ts',
					side: 'right',
					line: 9,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const added = true',
				},
			},
			expect.any(Object)
		)
	})

	test('keeps a thread open until the resolve mutation succeeds', async () => {
		const openThread = thread({
			id: '00000000-0000-4000-8000-000000000004',
			body: 'Please rename this',
		})
		useResolveMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: vi.fn(),
		} as never)
		const user = userEvent.setup()

		render(
			<PullRequestThreadCard
				number="1"
				permissions={{ ...FULL_VIEWER, viewerUserId: undefined }}
				slug="notes"
				thread={openThread}
				username="marta"
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Resolve' }))

		expect(screen.getByText('Please rename this')).toBeTruthy()
	})

	test('collapses only after resolve succeeds and refreshed data is resolved', async () => {
		const openThread = thread({
			id: '00000000-0000-4000-8000-000000000015',
			body: 'Collapse after refresh',
		})
		useResolveMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: vi.fn((_input, options) => options?.onSuccess?.()),
		} as never)
		const user = userEvent.setup()
		const props = {
			number: '1',
			permissions: { ...FULL_VIEWER, viewerUserId: AUTHOR_USER_ID },
			slug: 'notes',
			username: 'marta',
		}
		const { rerender } = render(
			<PullRequestThreadCard {...props} thread={openThread} />
		)

		await user.click(screen.getByRole('button', { name: 'Resolve' }))
		expect(screen.getByText('Collapse after refresh')).toBeTruthy()
		rerender(
			<PullRequestThreadCard
				{...props}
				thread={{
					...openThread,
					resolved: {
						at: createdAt,
						byUserId: AUTHOR_USER_ID,
						byUsername: 'marta',
					},
				}}
			/>
		)
		expect(screen.queryByText('Collapse after refresh')).toBeNull()
	})

	test('shows a resolve failure on a collapsed resolved thread', () => {
		useResolveMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new Error('resolve failed'),
			isError: true,
		} as never)

		render(
			<PullRequestThreadCard
				number="1"
				permissions={{ ...FULL_VIEWER, viewerUserId: undefined }}
				slug="notes"
				thread={thread({
					id: '00000000-0000-4000-8000-000000000005',
					body: 'Hidden while resolved',
					resolved: true,
				})}
				username="marta"
			/>
		)

		expect(screen.queryByText('Hidden while resolved')).toBeNull()
		expect(screen.getByRole('alert').textContent).toContain(
			'The thread state could not be changed.'
		)
	})

	test('renders a merged timeline with labels, markdown, replies, and own-comment actions', async () => {
		const topLevelThread = thread({
			id: '00000000-0000-4000-8000-000000000006',
			body: '**Markdown body**',
		})
		topLevelThread.comments.push({
			id: '00000000-0000-4000-8000-000000000007' as PullRequestCommentId,
			threadId: topLevelThread.id,
			authorUserId: '00000000-0000-4000-8000-0000000000b2' as ThreadAuthorId,
			authorUsername: 'jan',
			body: 'Reply body',
			state: 'published',
			createdAt: new Date('2026-08-06T11:30:00Z'),
		})
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [topLevelThread],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: { ...FULL_VIEWER, canDeleteAnyComment: false },
			},
			isLoading: false,
			isError: false,
		} as never)
		const events = [
			pullRequestEvent(
				'00000000-0000-4000-8000-000000000008',
				'opened',
				'2026-08-06T09:00:00Z'
			),
			pullRequestEvent(
				'00000000-0000-4000-8000-000000000009',
				'commented',
				'2026-08-06T10:30:00Z'
			),
			pullRequestEvent(
				'00000000-0000-4000-8000-000000000010',
				'thread_resolved',
				'2026-08-06T12:00:00Z'
			),
			pullRequestEvent(
				'00000000-0000-4000-8000-000000000011',
				'thread_unresolved',
				'2026-08-06T13:00:00Z'
			),
		]
		const user = userEvent.setup()

		render(
			<PullRequestTimeline
				events={events}
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.getByText('Markdown body').tagName).toBe('STRONG')
		expect(screen.getByText('Reply body')).toBeTruthy()
		expect(screen.queryByText(COMMENTED_EVENT_REGEX)).toBeNull()
		expect(screen.getByText(RESOLVED_EVENT_REGEX)).toBeTruthy()
		expect(screen.getByText(UNRESOLVED_EVENT_REGEX)).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Edit comment' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Delete comment' })).toBeTruthy()
		expect(
			screen.getAllByRole('button', { name: 'Edit comment' })
		).toHaveLength(1)
		expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy()
		expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy()
		await user.click(screen.getByRole('button', { name: 'Reply' }))
		expect(
			screen.getByRole('textbox', { name: 'Reply to thread' })
		).toBeTruthy()
	})

	test('collapses resolved threads and expands them on demand', async () => {
		const user = userEvent.setup()
		render(
			<PullRequestThreadCard
				number="1"
				permissions={{ ...FULL_VIEWER, viewerUserId: AUTHOR_USER_ID }}
				slug="notes"
				thread={thread({
					id: '00000000-0000-4000-8000-000000000012',
					body: 'Collapsed body',
					resolved: true,
				})}
				username="marta"
			/>
		)

		expect(screen.queryByText('Collapsed body')).toBeNull()
		await user.click(screen.getByRole('button', { name: 'Show 1 comment' }))
		expect(screen.getByText('Collapsed body')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Unresolve' })).toBeTruthy()
	})

	test('hides all composers when server authority denies comments', () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [
					thread({
						id: '00000000-0000-4000-8000-000000000013',
						body: 'Read only',
					}),
				],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: {
					canComment: false,
					canResolveAnyThread: false,
					canDeleteAnyComment: false,
				},
			},
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestTimeline
				events={[]}
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.queryByRole('textbox')).toBeNull()
		expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
	})

	test('adds a top-level comment to a review with the displayed comparison marker', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()
		render(
			<PullRequestTimeline
				events={[]}
				number="1"
				review={{ canSubmitReview: true, hasPendingReview: false }}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		await user.type(
			screen.getByRole('textbox', { name: 'Comment' }),
			'Review note'
		)
		await user.click(screen.getByRole('button', { name: 'Start a review' }))

		expect(mutate).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				body: 'Review note',
				review: { expectedHeadSha: HEAD_SHA },
			},
			expect.anything()
		)
	})

	test('keeps the head the line composer opened against when the branch moves mid-draft', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()
		const comparison = () => (
			<PullRequestComparison
				number="1"
				review={{ canSubmitReview: true, hasPendingReview: true }}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		const { rerender } = render(comparison())

		await user.click(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		)
		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 1' })
		)
		const composer = screen.getByRole('textbox', { name: 'Comment on line 1' })
		fireEvent.change(composer, { target: { value: 'Line note' } })

		// A background refetch lands while the comment is being written.
		useComparisonQueryMock.mockReturnValue({
			data: { ...COMPARISON, headSha: MOVED_HEAD_SHA },
			isLoading: false,
			isError: false,
		} as never)
		rerender(comparison())
		await user.click(screen.getByRole('button', { name: 'Add to review' }))

		expect(mutate).toHaveBeenLastCalledWith(
			expect.objectContaining({ review: { expectedHeadSha: HEAD_SHA } }),
			expect.anything()
		)
	})

	test('keeps the head the composer opened against when the branch moves mid-draft', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()
		const timeline = () => (
			<PullRequestTimeline
				events={[]}
				number="1"
				review={{ canSubmitReview: true, hasPendingReview: true }}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)
		const { rerender } = render(timeline())

		await user.type(
			screen.getByRole('textbox', { name: 'Comment' }),
			'Review note'
		)

		// A background refetch lands while the comment is being written.
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: MOVED_HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		rerender(timeline())
		await user.click(screen.getByRole('button', { name: 'Add to review' }))

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ review: { expectedHeadSha: HEAD_SHA } }),
			expect.anything()
		)
	})

	test('hides the review action when review submission is not allowed', () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestTimeline
				events={[]}
				number="1"
				review={{ canSubmitReview: false, hasPendingReview: false }}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.queryByRole('button', { name: 'Start a review' })).toBeNull()
	})

	test("marks the author's pending comment as Pending", () => {
		const pendingThread = thread({
			id: '00000000-0000-4000-8000-000000000016',
			body: 'Private draft',
		})
		pendingThread.comments[0].state = 'pending'
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [pendingThread],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		render(
			<PullRequestTimeline
				events={[]}
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.getByText('Pending')).toBeTruthy()
		// Resolving writes a public event, so a thread that is still a private
		// draft offers nothing to resolve.
		expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
	})
})

function pullRequestEvent(
	id: string,
	type: PullRequestEvent['type'],
	createdAt: string
): PullRequestEvent {
	return {
		id: id as PullRequestEvent['id'],
		pullRequestId:
			'00000000-0000-4000-8000-000000000099' as PullRequestEvent['pullRequestId'],
		provider: 'tessera',
		actorUsername: 'marta',
		type,
		createdAt: new Date(createdAt),
	}
}
