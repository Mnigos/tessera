import type {
	PullRequestChangedFile,
	PullRequestComment,
	PullRequestReview,
	PullRequestReviewComparison as PullRequestReviewComparisonData,
	PullRequestReviewViewer,
	PullRequestThread,
	PullRequestThreadViewer,
	SessionUser,
} from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import { usePullRequestReviewComparisonQuery } from '../hooks/use-pull-request-review-comparison.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestComparison } from './pull-request-comparison'

vi.mock('@/modules/auth/hooks/use-auth', () => ({
	useAuth: () => ({ user: undefined }),
}))

vi.mock('../hooks/use-pull-request-comparison.query', () => ({
	usePullRequestComparisonQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-review-comparison.query', () => ({
	usePullRequestReviewComparisonQuery: vi.fn(),
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

vi.mock('../hooks/use-submit-pull-request-review.mutation', () => ({
	useSubmitPullRequestReviewMutation: () => ({
		error: undefined,
		isPending: false,
		mutate: vi.fn(),
		reset: vi.fn(),
	}),
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
	useResolvePullRequestThreadMutation: () => IDLE_MUTATION,
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

const NO_REVIEW_VIEWER: PullRequestReviewViewer = {
	allowedOutcomes: [],
	canRequestReviewers: false,
	canRemoveReviewerRequests: false,
}
const COMMENT_REVIEW_VIEWER: PullRequestReviewViewer = {
	...NO_REVIEW_VIEWER,
	allowedOutcomes: ['comment'],
}
const useComparisonQueryMock = vi.mocked(usePullRequestComparisonQuery)
const useCreateThreadMutationMock = vi.mocked(
	useCreatePullRequestThreadMutation
)
const useFileDiffQueryMock = vi.mocked(usePullRequestFileDiffQuery)
const useReviewComparisonQueryMock = vi.mocked(
	usePullRequestReviewComparisonQuery
)
const useThreadsQueryMock = vi.mocked(usePullRequestThreadsQuery)

const VIEWER_USER_ID =
	'00000000-0000-4000-8000-0000000000a1' as SessionUser['id']
const OTHER_USER_ID =
	'00000000-0000-4000-8000-0000000000a2' as SessionUser['id']
const CANONICAL_BASE_SHA = 'a'.repeat(40)
const CURRENT_HEAD_SHA = 'b'.repeat(40)
const ANCESTOR_SHA = 'c'.repeat(40)
const REVIEW_HEAD_SHA = 'd'.repeat(40)
const CHANGED_FILE_BUTTON_NAME_REGEX = /src\/index\.ts/
const CHANGES_SINCE_REGEX = /Changes since marta reviewed on/
const DIVERGED_REGEX = /no longer an ancestor of the current head/
const NOTHING_NEW_REGEX = /Nothing new since marta reviewed on/
const MISSING_COMMIT_REGEX = /no longer in this repository/
const OTHER_REVIEWER_OPTION_REGEX = /jan/
const submittedAt = new Date('2026-08-08T10:00:00.000Z')

const FULL_VIEWER: PullRequestThreadViewer = {
	canComment: true,
	canResolveAnyThread: true,
	canDeleteAnyComment: true,
}

const REVIEWED_LINE_THREAD: PullRequestThread = {
	id: '00000000-0000-4000-8000-000000000021' as PullRequestThread['id'],
	kind: 'inline',
	anchor: {
		path: 'src/index.ts',
		side: 'left',
		startLine: 4,
		endLine: 4,
		anchorSha: CANONICAL_BASE_SHA,
		baseSha: CANONICAL_BASE_SHA,
		headSha: CURRENT_HEAD_SHA,
		lineExcerpt: 'const answer = 41',
	},
	currentAnchor: {
		path: 'src/index.ts',
		side: 'left',
		startLine: 4,
		endLine: 4,
	},
	outdated: false,
	createdAt: submittedAt,
	comments: [
		{
			id: '00000000-0000-4000-8000-000000000022' as PullRequestComment['id'],
			threadId:
				'00000000-0000-4000-8000-000000000021' as PullRequestThread['id'],
			author: {
				key: OTHER_USER_ID,
				provider: 'tessera',
				userId: OTHER_USER_ID,
				username: 'jan',
			},
			body: 'Anchored to a line of the pull request base',
			state: 'published',
			createdAt: submittedAt,
		},
	],
}

const CURRENT_LINE_THREAD: PullRequestThread = {
	id: '00000000-0000-4000-8000-000000000023' as PullRequestThread['id'],
	kind: 'inline',
	anchor: {
		path: 'src/index.ts',
		side: 'right',
		startLine: 9,
		endLine: 9,
		anchorSha: CURRENT_HEAD_SHA,
		baseSha: CANONICAL_BASE_SHA,
		headSha: CURRENT_HEAD_SHA,
		lineExcerpt: 'const answer = 42',
	},
	currentAnchor: {
		path: 'src/index.ts',
		side: 'right',
		startLine: 9,
		endLine: 9,
	},
	outdated: false,
	createdAt: submittedAt,
	comments: [
		{
			id: '00000000-0000-4000-8000-000000000024' as PullRequestComment['id'],
			threadId:
				'00000000-0000-4000-8000-000000000023' as PullRequestThread['id'],
			author: {
				key: OTHER_USER_ID,
				provider: 'tessera',
				userId: OTHER_USER_ID,
				username: 'jan',
			},
			body: 'Anchored to the current pull request head',
			state: 'published',
			createdAt: submittedAt,
		},
	],
}

const CHANGED_FILE = {
	status: 'modified',
	oldPath: 'src/index.ts',
	newPath: 'src/index.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	additions: 1,
	deletions: 1,
	isBinary: false,
} satisfies PullRequestChangedFile

function review(
	id: string,
	username: string,
	userId: SessionUser['id']
): PullRequestReview {
	return {
		id: id as PullRequestReview['id'],
		reviewer: { key: userId, provider: 'tessera', userId, username },
		state: 'submitted',
		outcome: 'approve',
		body: '',
		headSha: REVIEW_HEAD_SHA,
		submittedAt,
	}
}

const VIEWER_REVIEW = review(
	'00000000-0000-4000-8000-000000000011',
	'marta',
	VIEWER_USER_ID
)
const LATEST_REVIEW = review(
	'00000000-0000-4000-8000-000000000012',
	'jan',
	OTHER_USER_ID
)
const REVIEWS = [VIEWER_REVIEW, LATEST_REVIEW]

const REVIEW_COMPARISON = {
	status: 'ready',
	review: {
		id: VIEWER_REVIEW.id,
		reviewer: VIEWER_REVIEW.reviewer,
		state: 'submitted',
		outcome: 'approve',
		headSha: REVIEW_HEAD_SHA,
		submittedAt,
	},
	canonicalBaseSha: CANONICAL_BASE_SHA,
	currentHeadSha: CURRENT_HEAD_SHA,
	historiesDiverged: false,
	comparison: {
		baseSha: REVIEW_HEAD_SHA,
		headSha: CURRENT_HEAD_SHA,
		mergeBaseSha: REVIEW_HEAD_SHA,
		commits: [],
		files: [CHANGED_FILE],
		isTruncated: false,
		commitsTruncated: false,
		commitLimit: 500,
		fileLimit: 300,
	},
} satisfies PullRequestReviewComparisonData

const FILE_DIFF = {
	data: {
		baseSha: REVIEW_HEAD_SHA,
		headSha: CURRENT_HEAD_SHA,
		mergeBaseSha: REVIEW_HEAD_SHA,
		file: CHANGED_FILE,
		language: 'typescript',
		hunks: [
			{
				header: '@@ -4 +9 @@',
				lines: [
					{
						kind: 'deletion',
						content: 'const answer = 41',
						old: {
							sha: REVIEW_HEAD_SHA,
							path: 'src/index.ts',
							line: 4,
							side: 'left',
						},
					},
					{
						kind: 'addition',
						content: 'const answer = 42',
						new: {
							sha: CURRENT_HEAD_SHA,
							path: 'src/index.ts',
							line: 9,
							side: 'right',
						},
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

function renderComparison({
	onSelectedReviewIdChange = vi.fn(),
	reviewViewer = NO_REVIEW_VIEWER,
	selectedReviewId,
	viewerUserId,
}: {
	onSelectedReviewIdChange?: (reviewId?: PullRequestReview['id']) => void
	reviewViewer?: PullRequestReviewViewer
	selectedReviewId?: PullRequestReview['id']
	viewerUserId?: SessionUser['id']
} = {}) {
	return render(
		<PullRequestComparison
			isGitHubAuthoritative={false}
			number="1"
			reviewSelection={{
				reviewId: selectedReviewId,
				onReviewIdChange: onSelectedReviewIdChange,
			}}
			reviews={REVIEWS}
			reviewViewer={reviewViewer}
			slug="notes"
			tab="files"
			username="marta"
			viewerUserId={viewerUserId}
		/>
	)
}

describe('pull request review comparison', () => {
	beforeEach(() => {
		useComparisonQueryMock.mockReturnValue({
			data: {
				baseSha: CANONICAL_BASE_SHA,
				headSha: CURRENT_HEAD_SHA,
				mergeBaseSha: CANONICAL_BASE_SHA,
				commits: [],
				files: [CHANGED_FILE],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			},
			isLoading: false,
			isError: false,
		} as never)
		useReviewComparisonQueryMock.mockReturnValue({
			data: REVIEW_COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue(FILE_DIFF as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: {
					baseSha: CANONICAL_BASE_SHA,
					headSha: CURRENT_HEAD_SHA,
				},
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)
		useCreateThreadMutationMock.mockReturnValue(IDLE_MUTATION as never)
	})

	afterEach(() => {
		vi.resetAllMocks()
	})

	test('leaves the full diff alone until a review is chosen', async () => {
		const onSelectedReviewIdChange = vi.fn()
		const user = userEvent.setup()

		renderComparison({
			onSelectedReviewIdChange,
			viewerUserId: VIEWER_USER_ID,
		})

		expect(useReviewComparisonQueryMock).not.toHaveBeenCalled()
		expect(
			screen
				.getByRole('button', { name: 'Full diff' })
				.getAttribute('aria-pressed')
		).toBe('true')
		await user.click(screen.getByRole('button', { name: 'Since review' }))
		// The viewer's own latest review is what they are most likely catching up on.
		expect(onSelectedReviewIdChange).toHaveBeenCalledWith(VIEWER_REVIEW.id)
	})

	test('falls back to the newest review for a viewer who left none', async () => {
		const onSelectedReviewIdChange = vi.fn()
		const user = userEvent.setup()

		renderComparison({ onSelectedReviewIdChange })

		await user.click(screen.getByRole('button', { name: 'Since review' }))

		expect(onSelectedReviewIdChange).toHaveBeenCalledWith(LATEST_REVIEW.id)
	})

	test('names the reviewed and current commits and reads files between them', () => {
		renderComparison({
			selectedReviewId: VIEWER_REVIEW.id,
			viewerUserId: VIEWER_USER_ID,
		})

		expect(useReviewComparisonQueryMock).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes',
			number: '1',
			reviewId: VIEWER_REVIEW.id,
		})
		expect(
			screen.getByText(CHANGES_SINCE_REGEX, { selector: 'p' })
		).toBeTruthy()
		expect(screen.getByTitle(REVIEW_HEAD_SHA).textContent).toBe(
			REVIEW_HEAD_SHA.slice(0, 7)
		)
		expect(screen.getByTitle(CURRENT_HEAD_SHA)).toBeTruthy()

		// The expanded file is read between the reviewed commit and the current
		// head, not between the pull request's own base and head.
		expect(useFileDiffQueryMock).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				path: 'src/index.ts',
				expectedBaseSha: REVIEW_HEAD_SHA,
				expectedHeadSha: CURRENT_HEAD_SHA,
			},
			true
		)
	})

	test('shows the review trigger only for a ready since-review comparison', () => {
		const rendered = renderComparison({
			reviewViewer: COMMENT_REVIEW_VIEWER,
			selectedReviewId: VIEWER_REVIEW.id,
		})

		expect(screen.getByRole('button', { name: 'Review changes' })).toBeTruthy()

		for (const status of ['nothing_new', 'review_head_unavailable'] as const) {
			useReviewComparisonQueryMock.mockReturnValue({
				data: {
					status,
					review: REVIEW_COMPARISON.review,
					canonicalBaseSha: CANONICAL_BASE_SHA,
					currentHeadSha: CURRENT_HEAD_SHA,
				},
				isLoading: false,
				isError: false,
			} as never)
			rendered.rerender(
				<PullRequestComparison
					isGitHubAuthoritative={false}
					number="1"
					reviewSelection={{
						reviewId: VIEWER_REVIEW.id,
						onReviewIdChange: vi.fn(),
					}}
					reviews={REVIEWS}
					reviewViewer={COMMENT_REVIEW_VIEWER}
					slug="notes"
					tab="files"
					username="marta"
				/>
			)

			expect(
				screen.queryByRole('button', { name: 'Review changes' })
			).toBeNull()
		}
	})

	test('anchors a right-side comment to the pull request comparison', async () => {
		const mutate = vi.fn()
		useCreateThreadMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		const user = userEvent.setup()

		renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		// A left-side line is numbered against the merge base of the two heads, so
		// there is nothing to anchor it to in the full diff.
		expect(
			screen.queryByRole('button', { name: 'Comment on original line 4' })
		).toBeNull()
		expect(
			screen.getByText(
				'Comments on already-reviewed lines are available in the full diff.'
			)
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Comment on updated line 9' })
		)
		const composer = screen.getByRole('textbox', { name: 'Comment on line 9' })
		fireEvent.change(composer, { target: { value: 'Still off by one' } })
		fireEvent.submit(composer.closest('form') ?? composer)

		expect(mutate).toHaveBeenLastCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				body: 'Still off by one',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 9,
					endLine: 9,
					anchorSha: CURRENT_HEAD_SHA,
					baseSha: CANONICAL_BASE_SHA,
					headSha: CURRENT_HEAD_SHA,
					lineExcerpt: 'const answer = 42',
				},
			},
			expect.any(Object)
		)
	})

	test('places canonical right-side threads and lists canonical left-side threads', () => {
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [REVIEWED_LINE_THREAD, CURRENT_LINE_THREAD],
				comparison: {
					baseSha: CANONICAL_BASE_SHA,
					headSha: CURRENT_HEAD_SHA,
				},
				viewer: FULL_VIEWER,
			},
			isLoading: false,
			isError: false,
		} as never)

		renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		// Left line 4 of this diff is a different line from left line 4 of the pull
		// request's own diff, so the comment is listed rather than placed there.
		expect(screen.getByText('Comments on lines not shown (1)')).toBeTruthy()
		expect(
			screen.getByText('Anchored to a line of the pull request base')
		).toBeTruthy()
		expect(
			screen.getByText('Anchored to the current pull request head')
		).toBeTruthy()
	})

	test('forgets collapsed files when the selected comparison pair changes', async () => {
		const user = userEvent.setup()
		const rendered = renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		await user.click(
			screen.getByRole('button', { name: CHANGED_FILE_BUTTON_NAME_REGEX })
		)
		expect(
			screen
				.getByRole('button', { name: CHANGED_FILE_BUTTON_NAME_REGEX })
				.getAttribute('aria-expanded')
		).toBe('false')
		const nextReviewHeadSha = 'e'.repeat(40)
		const nextCurrentHeadSha = 'f'.repeat(40)
		useReviewComparisonQueryMock.mockReturnValue({
			data: {
				...REVIEW_COMPARISON,
				review: {
					...REVIEW_COMPARISON.review,
					id: LATEST_REVIEW.id,
					headSha: nextReviewHeadSha,
				},
				currentHeadSha: nextCurrentHeadSha,
				comparison: {
					...REVIEW_COMPARISON.comparison,
					baseSha: nextReviewHeadSha,
					headSha: nextCurrentHeadSha,
				},
			},
			isLoading: false,
			isError: false,
		} as never)

		rendered.rerender(
			<PullRequestComparison
				isGitHubAuthoritative={false}
				number="1"
				reviewSelection={{
					reviewId: LATEST_REVIEW.id,
					onReviewIdChange: vi.fn(),
				}}
				reviews={REVIEWS}
				reviewViewer={NO_REVIEW_VIEWER}
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		expect(
			screen
				.getByRole('button', { name: CHANGED_FILE_BUTTON_NAME_REGEX })
				.getAttribute('aria-expanded')
		).toBe('true')
	})

	test('says the reviewed history diverged instead of implying a clean interval', () => {
		useReviewComparisonQueryMock.mockReturnValue({
			data: {
				...REVIEW_COMPARISON,
				historiesDiverged: true,
				comparison: {
					...REVIEW_COMPARISON.comparison,
					mergeBaseSha: ANCESTOR_SHA,
				},
			},
			isLoading: false,
			isError: false,
		} as never)

		renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		expect(screen.getByText(DIVERGED_REGEX, { selector: 'p' })).toBeTruthy()
		expect(screen.getByTitle(ANCESTOR_SHA)).toBeTruthy()
	})

	test('states that nothing arrived rather than showing an empty diff', () => {
		useReviewComparisonQueryMock.mockReturnValue({
			data: {
				status: 'nothing_new',
				review: REVIEW_COMPARISON.review,
				canonicalBaseSha: CANONICAL_BASE_SHA,
				currentHeadSha: CURRENT_HEAD_SHA,
			},
			isLoading: false,
			isError: false,
		} as never)

		renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		expect(screen.getByText(NOTHING_NEW_REGEX, { selector: 'p' })).toBeTruthy()
		expect(screen.queryByText('No changed files')).toBeNull()
		expect(
			screen.queryByRole('button', { name: CHANGED_FILE_BUTTON_NAME_REGEX })
		).toBeNull()
	})

	test('explains a reviewed commit the repository no longer holds', async () => {
		const onSelectedReviewIdChange = vi.fn()
		useReviewComparisonQueryMock.mockReturnValue({
			data: {
				status: 'review_head_unavailable',
				review: REVIEW_COMPARISON.review,
				canonicalBaseSha: CANONICAL_BASE_SHA,
				currentHeadSha: CURRENT_HEAD_SHA,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()

		renderComparison({
			onSelectedReviewIdChange,
			selectedReviewId: VIEWER_REVIEW.id,
		})

		expect(
			screen.getByText(MISSING_COMMIT_REGEX, { selector: 'p' })
		).toBeTruthy()
		await user.click(screen.getByRole('button', { name: 'Full diff' }))

		expect(onSelectedReviewIdChange).toHaveBeenCalledWith(undefined)
	})

	test('keeps the way back to the full diff when the comparison fails', () => {
		useReviewComparisonQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)

		renderComparison({ selectedReviewId: VIEWER_REVIEW.id })

		expect(screen.getByText('Comparison unavailable')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Full diff' })).toBeTruthy()
	})

	test('keeps the full-diff escape for a valid review id absent from history', () => {
		const missingReviewId =
			'00000000-0000-4000-8000-000000000099' as PullRequestReview['id']
		useReviewComparisonQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)

		renderComparison({ selectedReviewId: missingReviewId })

		expect(screen.getByText('Comparison unavailable')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Full diff' })).toBeTruthy()
	})

	test('switches the compared review from the selector', async () => {
		const onSelectedReviewIdChange = vi.fn()
		const user = userEvent.setup()

		renderComparison({
			onSelectedReviewIdChange,
			selectedReviewId: VIEWER_REVIEW.id,
		})

		await user.click(
			screen.getByRole('combobox', { name: 'Review to compare against' })
		)
		await user.click(
			screen.getByRole('option', { name: OTHER_REVIEWER_OPTION_REGEX })
		)

		expect(onSelectedReviewIdChange).toHaveBeenCalledWith(LATEST_REVIEW.id)
	})
})
