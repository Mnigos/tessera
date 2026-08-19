import { ORPCError } from '@orpc/client'
import type {
	PullRequestChangedFile,
	PullRequestCommentId,
	PullRequestComparison as PullRequestComparisonData,
	PullRequestEvent,
	PullRequestReviewOutcome,
	PullRequestReviewViewer,
	PullRequestThread,
	PullRequestThreadId,
	PullRequestThreadViewer,
} from '@repo/contracts'
import {
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
} from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { useEditPullRequestCommentMutation } from '../hooks/use-edit-pull-request-comment.mutation'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { useReplyPullRequestThreadMutation } from '../hooks/use-reply-pull-request-thread.mutation'
import { useResolvePullRequestThreadMutation } from '../hooks/use-resolve-pull-request-thread.mutation'
import { PullRequestComparison } from './pull-request-comparison'
import { PullRequestThreadCard } from './pull-request-thread-card'
import { PullRequestTimeline } from './pull-request-timeline'

vi.mock('../hooks/use-pull-request-activity.query', () => ({
	usePullRequestActivityQuery: () => ({ data: undefined }),
}))

vi.mock('../hooks/use-refresh-pull-request-github.mutation', () => ({
	useRefreshPullRequestGitHubMutation: () => ({
		isPending: false,
		mutate: vi.fn(),
	}),
}))

vi.mock('@/modules/auth/hooks/use-auth', () => ({
	useAuth: () => ({ user: undefined }),
}))

vi.mock('@/modules/repositories/hooks/use-github-sync-health.query', () => ({
	useGitHubSyncHealthQuery: () => ({
		data: undefined,
		isError: false,
		isLoading: false,
	}),
}))

vi.mock('../hooks/use-pull-request-comparison.query', () => ({
	usePullRequestComparisonQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-file-expansion', () => ({
	usePullRequestFileExpansion: () => ({
		lines: new Map(),
		expand: vi.fn(),
		retry: vi.fn(),
	}),
}))

vi.mock('../hooks/use-pull-request-file-diff.query', () => ({
	usePullRequestFileDiffQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-viewed-files.query', () => ({
	usePullRequestViewedFilesQuery: () => ({ data: undefined }),
}))

vi.mock('../hooks/use-set-pull-request-file-viewed.mutation', () => ({
	useSetPullRequestFileViewedMutation: () => IDLE_MUTATION,
}))

vi.mock('../hooks/use-prefetch-pull-request-file-diff', () => ({
	usePrefetchPullRequestFileDiff: () => prefetchFileDiffMock,
}))

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: vi.fn(),
}))

vi.mock('../hooks/use-create-pull-request-thread.mutation', () => ({
	useCreatePullRequestThreadMutation: vi.fn(),
}))

vi.mock('../hooks/use-reply-pull-request-thread.mutation', () => ({
	useReplyPullRequestThreadMutation: vi.fn(),
}))

vi.mock('../hooks/use-edit-pull-request-comment.mutation', () => ({
	useEditPullRequestCommentMutation: vi.fn(),
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

const prefetchFileDiffMock = vi.fn()

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
const useEditCommentMutationMock = vi.mocked(useEditPullRequestCommentMutation)
const useReplyMutationMock = vi.mocked(useReplyPullRequestThreadMutation)
const useThreadsQueryMock = vi.mocked(usePullRequestThreadsQuery)
const useResolveMutationMock = vi.mocked(useResolvePullRequestThreadMutation)

type ThreadAuthor = PullRequestThread['comments'][number]['author']
type ThreadAuthorId = NonNullable<ThreadAuthor['userId']>

const AUTHOR_USER_ID = '00000000-0000-4000-8000-0000000000a1' as ThreadAuthorId

function threadAuthor(userId: ThreadAuthorId, username: string): ThreadAuthor {
	return { key: userId, provider: 'tessera', userId, username }
}
const createdAt = new Date('2026-08-06T10:00:00.000Z')
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MOVED_HEAD_SHA = 'c'.repeat(40)
const COMMENTED_EVENT_REGEX = /Pull request commented/
const RESOLVED_EVENT_REGEX = /Comment thread resolved by marta/
const UNRESOLVED_EVENT_REGEX = /Comment thread unresolved by marta/

const FULL_VIEWER: PullRequestThreadViewer = {
	canComment: true,
	canResolveAnyThread: true,
	canDeleteAnyComment: true,
}

const ALL_REVIEW_OUTCOMES: PullRequestReviewOutcome[] = [
	'comment',
	'approve',
	'request_changes',
]

const RENAMED_FILE_BUTTON_NAME_REGEX = /renamed src\/old\.ts → src\/new\.ts/

const NO_REVIEW_VIEWER: PullRequestReviewViewer = {
	allowedOutcomes: [],
	canRequestReviewers: false,
	canRemoveReviewerRequests: false,
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
	commentState = 'published',
}: {
	id: string
	path?: string
	body: string
	resolved?: boolean
	commentState?: PullRequestThread['comments'][number]['state']
}): PullRequestThread {
	return {
		id: id as PullRequestThreadId,
		kind: path ? 'inline' : 'top_level',
		anchor: path
			? {
					path,
					side: 'left',
					startLine: 1,
					endLine: 1,
					anchorSha: BASE_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const removed = 1',
				}
			: undefined,
		currentAnchor: path
			? { path, side: 'left', startLine: 1, endLine: 1 }
			: undefined,
		resolved: resolved
			? { at: createdAt, by: threadAuthor(AUTHOR_USER_ID, 'marta') }
			: undefined,
		outdated: false,
		createdAt,
		comments: [
			{
				id: `${id}-comment` as PullRequestCommentId,
				threadId: id as PullRequestThreadId,
				author: threadAuthor(AUTHOR_USER_ID, 'marta'),
				body,
				state: commentState,
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
		useEditCommentMutationMock.mockReturnValue(IDLE_MUTATION as never)
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue(FILE_DIFF as never)
		useResolveMutationMock.mockReturnValue(IDLE_MUTATION as never)
		useReplyMutationMock.mockReturnValue(IDLE_MUTATION as never)
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	test('fetches threads once for the whole pull request and keeps left-side threads on a renamed file', () => {
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
		render(
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
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
		expect(useThreadsQueryMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: expect.anything() })
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
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
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

	test('shows a matched-file thread under its file card when the diff has no hunks', () => {
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
		render(
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		expect(screen.queryByText('Outdated discussions (1)')).toBeNull()
		expect(screen.getByText('No text changes to display.')).toBeTruthy()
		expect(screen.getByText('Comments (1)')).toBeTruthy()
		expect(screen.getByText('Discussion with no rendered hunk')).toBeTruthy()
	})

	test.each([
		['without a session', undefined],
		['for a GitHub-authoritative pull request', AUTHOR_USER_ID],
	])('withholds line composers %s', (_context, viewerUserId) => {
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
		render(
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
				viewerUserId={viewerUserId}
			/>
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
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 4' })
		)
		const leftComposer = screen.getByRole('textbox', {
			name: 'Comment on line 4',
		})
		expect(
			leftComposer
				.closest('[data-thread-side]')
				?.getAttribute('data-thread-side')
		).toBe('left')
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
					startLine: 4,
					endLine: 4,
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
		expect(
			rightComposer
				.closest('[data-thread-side]')
				?.getAttribute('data-thread-side')
		).toBe('right')
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
					startLine: 9,
					endLine: 9,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const added = true',
				},
			},
			expect.any(Object)
		)
	})

	test('highlights every row in a range and renders its thread after the end line', () => {
		const rangeThread = thread({
			id: '00000000-0000-4000-8000-000000000020',
			path: 'src/old.ts',
			body: 'Range discussion',
		})
		if (!rangeThread.anchor) throw new Error('Range thread anchor missing')
		rangeThread.anchor = {
			...rangeThread.anchor,
			startLine: 2,
			endLine: 4,
			lineExcerpt: 'fourth removed line',
		}
		rangeThread.currentAnchor = {
			path: rangeThread.anchor.path,
			side: 'left',
			startLine: 2,
			endLine: 4,
		}
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [rangeThread],
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
						header: '@@ -1,5 +1 @@',
						lines: [1, 2, 3, 4, 5].map(line => ({
							kind: 'deletion' as const,
							content: `${line === 4 ? 'fourth' : `line ${line}`} removed line`,
							old: {
								sha: BASE_SHA,
								path: 'src/old.ts',
								line,
								side: 'left' as const,
							},
						})),
					},
				],
			},
		} as never)
		const { container } = render(
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		expect(
			screen.getByRole('button', { name: RENAMED_FILE_BUTTON_NAME_REGEX })
		).toBeTruthy()
		expect(container.querySelectorAll('[data-commented="true"]')).toHaveLength(
			3
		)
		const precedingRow = screen
			.getByRole('button', { name: 'Comment on original line 1' })
			.closest('[data-side="left"]')
		const followingRow = screen
			.getByRole('button', { name: 'Comment on original line 5' })
			.closest('[data-side="left"]')
		expect(precedingRow?.getAttribute('data-commented')).toBeNull()
		expect(followingRow?.getAttribute('data-commented')).toBeNull()
		const endLineButton = screen.getByRole('button', {
			name: 'Comment on original line 4',
		})
		const nextLineButton = screen.getByRole('button', {
			name: 'Comment on original line 5',
		})
		const threadBody = screen.getByText('Range discussion')
		expect(
			threadBody.closest('[data-thread-side]')?.getAttribute('data-thread-side')
		).toBe('left')
		expect(endLineButton.compareDocumentPosition(threadBody)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		)
		expect(threadBody.compareDocumentPosition(nextLineButton)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		)
	})

	test('labels a range thread with its path and ordered lines', () => {
		const rangeThread = thread({
			id: '00000000-0000-4000-8000-000000000021',
			path: 'src/old.ts',
			body: 'Range discussion',
		})
		if (!rangeThread.anchor) throw new Error('Range thread anchor missing')
		rangeThread.anchor = {
			...rangeThread.anchor,
			startLine: 2,
			endLine: 5,
		}

		render(
			<PullRequestThreadCard
				number="1"
				permissions={FULL_VIEWER}
				shouldShowAnchor
				slug="notes"
				thread={rangeThread}
				username="marta"
			/>
		)

		expect(screen.getByText('src/old.ts:2–5')).toBeTruthy()
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
						by: threadAuthor(AUTHOR_USER_ID, 'marta'),
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
			author: threadAuthor(
				'00000000-0000-4000-8000-0000000000b2' as ThreadAuthorId,
				'jan'
			),
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

		const { container } = render(
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={events}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.getByText('Markdown body').tagName).toBe('STRONG')
		expect(screen.getByText('Reply body')).toBeTruthy()
		expect(screen.queryByText(COMMENTED_EVENT_REGEX)).toBeNull()
		expect(container.textContent).toMatch(RESOLVED_EVENT_REGEX)
		expect(container.textContent).toMatch(UNRESOLVED_EVENT_REGEX)
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
		expect(screen.queryByRole('button', { name: 'Start a review' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Add to review' })).toBeNull()
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: false,
				}}
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

	test('leads the line composer with the review while one is pending', async () => {
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
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: true,
				}}
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 1' })
		)
		const composer = screen.getByRole('textbox', { name: 'Comment on line 1' })
		fireEvent.change(composer, { target: { value: 'Line note' } })

		expect(
			screen.getByRole('button', { name: 'Add review comment' })
		).toBeTruthy()
		await user.click(screen.getByRole('button', { name: 'Add single comment' }))

		expect(mutate).toHaveBeenLastCalledWith(
			expect.not.objectContaining({ review: expect.anything() }),
			expect.anything()
		)
	})

	test('submits the composer on the platform shortcut', () => {
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
		render(
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		const composer = screen.getByRole('textbox', { name: 'Comment' })
		fireEvent.change(composer, { target: { value: 'Shortcut note' } })
		fireEvent.keyDown(composer, { key: 'Enter', metaKey: true })

		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({ body: 'Shortcut note' }),
			expect.anything()
		)
	})

	test('offers the review action with the loaded head when data arrives after mount', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		} as never)
		const user = userEvent.setup()
		const { rerender } = render(
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: false,
				}}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		rerender(
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: false,
				}}
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
			expect.objectContaining({ review: { expectedHeadSha: HEAD_SHA } }),
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
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: true,
				}}
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		const { rerender } = render(comparison())

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
		fireEvent.submit(composer.closest('form') ?? composer)

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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: true,
				}}
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

	/**
	 * The composer only mounts once the thread capabilities have loaded, so the
	 * head it captures is the one already on screen. A comparison that arrives
	 * after the first render can never leave the review action inert.
	 */
	test('offers the review action when the threads query resolves after the first render', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		useThreadsQueryMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		} as never)
		const user = userEvent.setup()
		const timeline = () => (
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{
					allowedOutcomes: ALL_REVIEW_OUTCOMES,
					hasPendingReview: true,
				}}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)
		const { rerender } = render(timeline())

		expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull()

		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		rerender(timeline())

		await user.type(
			screen.getByRole('textbox', { name: 'Comment' }),
			'Review note'
		)
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
				number="1"
				review={{ allowedOutcomes: [], hasPendingReview: false }}
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		expect(screen.queryByRole('button', { name: 'Start a review' })).toBeNull()
	})

	test('offers immediate mirrored comments without batched-review actions', async () => {
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub
				isGitHubAuthoritative
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)

		await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Note')

		expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Start a review' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Add to review' })).toBeNull()
	})

	test('batches a mirrored inline comment into a review the reviewer starts', async () => {
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
			<PullRequestComparison
				isGitHubAuthoritative
				number="1"
				review={{
					allowedOutcomes: ['comment'],
					hasPendingReview: false,
				}}
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 1' })
		)
		await user.type(
			screen.getByRole('textbox', { name: 'Comment on line 1' }),
			'Inline note'
		)

		expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Start a review' })).toBeTruthy()
	})

	test.each([
		['mirrored top-level', true, undefined, false],
		['mirrored inline', true, 'src/old.ts', true],
		['native top-level', false, undefined, true],
	] as const)('offers thread actions correctly for %s', (_name, isGitHubAuthoritative, path, expected) => {
		render(
			<PullRequestThreadCard
				number="1"
				permissions={{
					...FULL_VIEWER,
					isGitHubAuthoritative,
					viewerUserId: AUTHOR_USER_ID,
				}}
				slug="notes"
				thread={thread({
					id: crypto.randomUUID(),
					path,
					body: 'Thread body',
				})}
				username="marta"
			/>
		)

		expect(Boolean(screen.queryByRole('button', { name: 'Reply' }))).toBe(
			expected
		)
		expect(Boolean(screen.queryByRole('button', { name: 'Resolve' }))).toBe(
			expected
		)
	})

	test('closes an open top-level reply when authority changes to GitHub', async () => {
		const user = userEvent.setup()
		const topLevelThread = thread({
			id: '00000000-0000-4000-8000-000000000017',
			body: 'Top level',
		})
		const props = {
			number: '1',
			slug: 'notes',
			thread: topLevelThread,
			username: 'marta',
		}
		const { rerender } = render(
			<PullRequestThreadCard
				{...props}
				permissions={{ ...FULL_VIEWER, viewerUserId: AUTHOR_USER_ID }}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Reply' }))
		expect(
			screen.getByRole('textbox', { name: 'Reply to thread' })
		).toBeTruthy()

		rerender(
			<PullRequestThreadCard
				{...props}
				permissions={{
					...FULL_VIEWER,
					isGitHubAuthoritative: true,
					viewerUserId: AUTHOR_USER_ID,
				}}
			/>
		)

		expect(
			screen.queryByRole('textbox', { name: 'Reply to thread' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
	})

	test('keeps an open inline reply when authority changes to GitHub', async () => {
		const user = userEvent.setup()
		const inlineThread = thread({
			id: '00000000-0000-4000-8000-000000000018',
			path: 'src/old.ts',
			body: 'Inline',
		})
		const props = {
			number: '1',
			slug: 'notes',
			thread: inlineThread,
			username: 'marta',
		}
		const { rerender } = render(
			<PullRequestThreadCard
				{...props}
				permissions={{ ...FULL_VIEWER, viewerUserId: AUTHOR_USER_ID }}
			/>
		)

		await user.click(screen.getByRole('button', { name: 'Reply' }))
		rerender(
			<PullRequestThreadCard
				{...props}
				permissions={{
					...FULL_VIEWER,
					isGitHubAuthoritative: true,
					viewerUserId: AUTHOR_USER_ID,
				}}
			/>
		)

		expect(
			screen.getByRole('textbox', { name: 'Reply to thread' })
		).toBeTruthy()
	})

	test('guards a delivered timeline comment only while its draft is unchanged', async () => {
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub
				isGitHubAuthoritative
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)
		const { rerender } = render(timeline())

		await user.type(
			screen.getByRole('textbox', { name: 'Comment' }),
			'Delivered note'
		)
		const commentButton = screen.getByRole('button', { name: 'Comment' })
		fireEvent.submit(commentButton.closest('form') ?? commentButton)

		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: 'Another conflict',
			}),
			isError: true,
			mutate,
		} as never)
		rerender(timeline())
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Comment' })
				.disabled
		).toBeFalsy()

		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate,
		} as never)
		rerender(timeline())

		expect(screen.getByRole('status').textContent).toBe(
			GITHUB_SYNC_DELAYED_MESSAGE
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Comment' })
				.disabled
		).toBeTruthy()

		await user.type(screen.getByRole('textbox', { name: 'Comment' }), '!')
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Comment' })
				.disabled
		).toBeFalsy()
		fireEvent.submit(commentButton.closest('form') ?? commentButton)
		expect(mutate).toHaveBeenCalledTimes(2)
	})

	test('guards delivered inline comments, replies, and edits by draft', async () => {
		const create = vi.fn()
		const reply = vi.fn()
		const edit = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: create,
		} as never)
		useReplyMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: reply,
		} as never)
		useEditCommentMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate: edit,
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
				isGitHubAuthoritative
				number="1"
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)
		const comparisonView = render(comparison())

		await user.click(
			screen.getByRole('button', { name: 'Comment on original line 1' })
		)
		await user.type(
			screen.getByRole('textbox', { name: 'Comment on line 1' }),
			'Inline delivered'
		)
		const inlineCommentButton = screen.getByRole('button', { name: 'Comment' })
		fireEvent.submit(inlineCommentButton.closest('form') ?? inlineCommentButton)
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate: create,
		} as never)
		comparisonView.rerender(comparison())
		// Only the selected row re-renders, so re-selecting it delivers the refusal.
		fireEvent.click(
			screen.getByRole('button', { name: 'Comment on original line 1' })
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Comment' })
				.disabled
		).toBeTruthy()
		await user.type(
			screen.getByRole('textbox', { name: 'Comment on line 1' }),
			'!'
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Comment' })
				.disabled
		).toBeFalsy()
		comparisonView.unmount()

		const inlineThread = thread({
			id: '00000000-0000-4000-8000-000000000019',
			path: 'src/old.ts',
			body: 'Editable body',
		})
		const card = () => (
			<PullRequestThreadCard
				number="1"
				permissions={{
					...FULL_VIEWER,
					isGitHubAuthoritative: true,
					viewerUserId: AUTHOR_USER_ID,
				}}
				slug="notes"
				thread={inlineThread}
				username="marta"
			/>
		)
		const cardView = render(card())

		await user.click(screen.getByRole('button', { name: 'Reply' }))
		await user.type(
			screen.getByRole('textbox', { name: 'Reply to thread' }),
			'Delivered reply'
		)
		const replyButton = screen.getByRole('button', { name: 'Reply' })
		fireEvent.submit(replyButton.closest('form') ?? replyButton)
		useReplyMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate: reply,
		} as never)
		cardView.rerender(card())
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Reply' }).disabled
		).toBeTruthy()
		await user.type(
			screen.getByRole('textbox', { name: 'Reply to thread' }),
			'!'
		)
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Reply' }).disabled
		).toBeFalsy()

		await user.click(screen.getByRole('button', { name: 'Cancel' }))
		await user.click(screen.getByRole('button', { name: 'Edit comment' }))
		const saveButton = screen.getByRole('button', { name: 'Save changes' })
		fireEvent.submit(saveButton.closest('form') ?? saveButton)
		useEditCommentMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: GITHUB_SYNC_DELAYED_MESSAGE,
			}),
			isError: true,
			mutate: edit,
		} as never)
		cardView.rerender(card())
		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Save changes',
			}).disabled
		).toBeTruthy()
		await user.type(screen.getByRole('textbox', { name: 'Edit comment' }), '!')
		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Save changes',
			}).disabled
		).toBeFalsy()
	})

	test('shows reconnect recovery and the timeline fallback', () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('UNAUTHORIZED', {
				status: 401,
				message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
			}),
			isError: true,
		} as never)
		const timeline = () => (
			<PullRequestTimeline
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub
				isGitHubAuthoritative
				number="1"
				slug="notes"
				username="marta"
				viewerUserId={AUTHOR_USER_ID}
			/>
		)
		const { rerender } = render(timeline())

		expect(
			screen.getByRole('button', { name: 'Reconnect GitHub' })
		).toBeTruthy()

		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			error: new ORPCError('INTERNAL_SERVER_ERROR', {
				status: 500,
				message: 'Internal detail',
			}),
			isError: true,
		} as never)
		rerender(timeline())

		expect(screen.getByText('The comment could not be posted.')).toBeTruthy()
	})

	test("marks the author's pending comment as Pending", () => {
		const pendingThread = thread({
			id: '00000000-0000-4000-8000-000000000016',
			body: 'Private draft',
			commentState: 'pending',
		})
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
				canReadSyncHealth={false}
				events={[]}
				isFromGitHub={false}
				isGitHubAuthoritative={false}
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
