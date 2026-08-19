import { ORPCError } from '@orpc/client'
import type {
	PullRequestChangedFile,
	PullRequestComparison,
	SessionUser,
} from '@repo/contracts'
import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducedMotion } from 'motion/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import {
	getPullRequestFileDiffQueryOptions,
	usePullRequestFileDiffQuery,
} from '../hooks/use-pull-request-file-diff.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { usePullRequestViewedFilesQuery } from '../hooks/use-pull-request-viewed-files.query'
import { useSetPullRequestFileViewedMutation } from '../hooks/use-set-pull-request-file-viewed.mutation'
import { PullRequestComparisonFiles } from './pull-request-comparison-files'

vi.mock('@/modules/auth/hooks/use-auth', () => ({
	useAuth: () => ({ user: undefined }),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
	...(await importOriginal<typeof import('@tanstack/react-query')>()),
	useQueryClient: vi.fn(),
}))

vi.mock('motion/react', () => ({
	AnimatePresence: ({ children }: { children: ReactNode }) => children,
	motion: {
		div: ({
			children,
			transition,
			...props
		}: HTMLAttributes<HTMLDivElement> & {
			children: ReactNode
			transition: { duration: number }
		}) => (
			<div data-transition-duration={transition.duration} {...props}>
				{children}
			</div>
		),
		span: ({
			children,
			...props
		}: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) => (
			<span {...props}>{children}</span>
		),
	},
	useReducedMotion: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-file-expansion', () => ({
	usePullRequestFileExpansion: () => ({
		lines: new Map(),
		expand: vi.fn(),
		retry: vi.fn(),
	}),
}))

vi.mock('../hooks/use-pull-request-file-diff.query', async importOriginal => ({
	...(await importOriginal<
		typeof import('../hooks/use-pull-request-file-diff.query')
	>()),
	usePullRequestFileDiffQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-viewed-files.query', () => ({
	usePullRequestViewedFilesQuery: vi.fn(),
}))

vi.mock('../hooks/use-set-pull-request-file-viewed.mutation', () => ({
	useSetPullRequestFileViewedMutation: vi.fn(),
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
	useResolvePullRequestThreadMutation: () => IDLE_MUTATION,
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

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const NEXT_BASE_SHA = 'c'.repeat(40)
const NEXT_HEAD_SHA = 'd'.repeat(40)
const FILES_VIEWED_REGEX = /files viewed/
const MARK_VIEWED_REGEX = /Mark .* viewed/
const VIEWER_USER_ID =
	'00000000-0000-4000-8000-000000000001' as SessionUser['id']

const useCreateThreadMutationMock = vi.mocked(
	useCreatePullRequestThreadMutation
)
const useFileDiffQueryMock = vi.mocked(usePullRequestFileDiffQuery)
const useQueryClientMock = vi.mocked(useQueryClient)
const useReducedMotionMock = vi.mocked(useReducedMotion)
const useSetViewedMutationMock = vi.mocked(useSetPullRequestFileViewedMutation)
const useThreadsQueryMock = vi.mocked(usePullRequestThreadsQuery)
const useViewedFilesQueryMock = vi.mocked(usePullRequestViewedFilesQuery)

function changedFile(
	path: string,
	overrides: Partial<PullRequestChangedFile> = {}
): PullRequestChangedFile {
	return {
		status: 'modified',
		oldPath: path,
		newPath: path,
		baseBlobId: `base-${path}`,
		headBlobId: `head-${path}`,
		additions: 1,
		deletions: 1,
		isBinary: false,
		...overrides,
	}
}

function comparison(
	files: PullRequestChangedFile[],
	baseSha = BASE_SHA,
	headSha = HEAD_SHA
): PullRequestComparison {
	return {
		baseSha,
		headSha,
		mergeBaseSha: baseSha,
		commits: [],
		files,
		isTruncated: false,
		commitsTruncated: false,
		commitLimit: 500,
		fileLimit: 300,
	}
}

function fileDiff(
	file: PullRequestChangedFile,
	baseSha = BASE_SHA,
	headSha = HEAD_SHA
) {
	return {
		data: {
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			file,
			language: 'typescript',
			hunks: [
				{
					header: '@@ -1 +1 @@',
					lines: [
						{
							kind: 'addition' as const,
							content: `const path = '${file.newPath}'`,
							new: {
								sha: headSha,
								path: file.newPath,
								line: 1,
								side: 'right' as const,
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
}

function renderFiles({
	files,
	isSinceReview = false,
	baseSha = BASE_SHA,
	headSha = HEAD_SHA,
	viewerUserId,
}: {
	files: PullRequestChangedFile[]
	isSinceReview?: boolean
	baseSha?: string
	headSha?: string
	viewerUserId?: SessionUser['id']
}) {
	const data = comparison(files, baseSha, headSha)

	return render(
		<PullRequestComparisonFiles
			anchorComparison={data}
			comparison={data}
			isSinceReview={isSinceReview}
			number="7"
			review={{ canSubmitReview: true, hasPendingReview: true }}
			slug="notes"
			username="marta"
			viewerUserId={viewerUserId}
		/>
	)
}

function fileHeader(path: string) {
	const header = screen
		.getAllByTitle(path)
		.map(element => element.closest('button'))
		.find(button => button?.hasAttribute('aria-expanded'))

	if (!header) throw new Error(`File header missing for ${path}`)

	return header
}

class ControlledIntersectionObserver implements IntersectionObserver {
	static instances: ControlledIntersectionObserver[] = []

	readonly root = null
	readonly rootMargin: string
	readonly thresholds = [0]
	private readonly targets = new Set<Element>()

	disconnect = vi.fn(() => this.targets.clear())
	takeRecords = vi.fn((): IntersectionObserverEntry[] => [])
	unobserve = vi.fn((target: Element) => this.targets.delete(target))

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) {
		this.rootMargin = options?.rootMargin ?? '0px'
		ControlledIntersectionObserver.instances.push(this)
	}

	observe = vi.fn((target: Element) => this.targets.add(target))

	intersectAll() {
		const entries = [...this.targets].map(
			target => ({ isIntersecting: true, target }) as IntersectionObserverEntry
		)

		this.callback(entries, this)
	}
}

describe(PullRequestComparisonFiles.name, () => {
	const originalIntersectionObserver = window.IntersectionObserver
	const prefetchQuery = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		useReducedMotionMock.mockReturnValue(false)
		useQueryClientMock.mockReturnValue({ prefetchQuery } as never)
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { baseSha: BASE_SHA, headSha: HEAD_SHA },
				viewer: {
					canComment: true,
					canResolveAnyThread: false,
					canDeleteAnyComment: false,
				},
			},
			isLoading: false,
			isError: false,
		} as never)
		useViewedFilesQueryMock.mockReturnValue({
			data: undefined,
			isSuccess: false,
			isError: false,
		} as never)
		useSetViewedMutationMock.mockReturnValue(IDLE_MUTATION as never)
		useCreateThreadMutationMock.mockReturnValue(IDLE_MUTATION as never)
		useFileDiffQueryMock.mockImplementation(
			input =>
				fileDiff(
					changedFile(input.path),
					input.expectedBaseSha,
					input.expectedHeadSha
				) as never
		)
	})

	afterEach(() => {
		window.IntersectionObserver = originalIntersectionObserver
		ControlledIntersectionObserver.instances = []
		vi.resetAllMocks()
	})

	test('expands ordinary files and gates large and binary diffs', async () => {
		const ordinary = changedFile('src/ordinary.ts', {
			additions: 799,
			deletions: 1,
		})
		const large = changedFile('src/large.ts', {
			additions: 800,
			deletions: 1,
		})
		const binary = changedFile('assets/logo.png', { isBinary: true })
		const user = userEvent.setup()

		renderFiles({ files: [ordinary, large, binary] })

		expect(fileHeader(ordinary.newPath).getAttribute('aria-expanded')).toBe(
			'true'
		)
		expect(fileHeader(large.newPath).getAttribute('aria-expanded')).toBe(
			'false'
		)
		expect(fileHeader(binary.newPath).getAttribute('aria-expanded')).toBe(
			'false'
		)
		expect(
			screen.getByRole('button', { name: 'Load diff for src/large.ts' })
		).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Load diff for assets/logo.png' })
		).toBeTruthy()
		expect(
			useFileDiffQueryMock.mock.calls.map(([input]) => input.path)
		).toEqual(['src/ordinary.ts'])
		useFileDiffQueryMock.mockClear()

		await user.click(
			screen.getByRole('button', { name: 'Load diff for src/large.ts' })
		)

		expect(fileHeader(large.newPath).getAttribute('aria-expanded')).toBe('true')
		expect(
			useFileDiffQueryMock.mock.calls.map(([input]) => input.path)
		).toEqual(['src/large.ts'])
	})

	test('shows changed-file copy until the authenticated viewed query succeeds', () => {
		const files = [changedFile('src/one.ts'), changedFile('src/two.ts')]
		const rendered = renderFiles({ files, viewerUserId: VIEWER_USER_ID })

		expect(screen.getByText('2 changed files')).toBeTruthy()
		expect(screen.queryByText(FILES_VIEWED_REGEX)).toBeNull()
		expect(screen.queryByRole('button', { name: MARK_VIEWED_REGEX })).toBeNull()

		useViewedFilesQueryMock.mockReturnValue({
			data: { headSha: HEAD_SHA, paths: ['src/one.ts'] },
			isSuccess: true,
			isError: false,
		} as never)
		rendered.rerender(
			<PullRequestComparisonFiles
				anchorComparison={comparison(files)}
				comparison={comparison(files)}
				number="7"
				slug="notes"
				username="marta"
				viewerUserId={VIEWER_USER_ID}
			/>
		)

		expect(screen.getByText('1 / 2 files viewed')).toBeTruthy()
		expect(
			screen.getByRole('button', { name: 'Mark src/two.ts viewed' })
		).toBeTruthy()
	})

	test('optimistically collapses a viewed file, disables repeat toggles, and rolls back errors', async () => {
		const file = changedFile('src/index.ts')
		const mutate = vi.fn()
		useViewedFilesQueryMock.mockReturnValue({
			data: { headSha: HEAD_SHA, paths: [] },
			isSuccess: true,
			isError: false,
		} as never)
		useSetViewedMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			mutate,
		} as never)
		const user = userEvent.setup()

		renderFiles({ files: [file], viewerUserId: VIEWER_USER_ID })
		const toggle = screen.getByRole('button', {
			name: 'Mark src/index.ts viewed',
		})

		await user.click(toggle)

		expect(mutate).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '7',
				expectedHeadSha: HEAD_SHA,
				path: 'src/index.ts',
				viewed: true,
			},
			expect.any(Object)
		)
		expect(fileHeader(file.newPath).getAttribute('aria-expanded')).toBe('false')
		expect(toggle.hasAttribute('disabled')).toBeTruthy()

		fireEvent.click(toggle)
		expect(mutate).toHaveBeenCalledOnce()

		const [, callbacks] = mutate.mock.calls[0] ?? []
		act(() => {
			callbacks.onError()
			callbacks.onSettled()
		})

		expect(fileHeader(file.newPath).getAttribute('aria-expanded')).toBe('true')
		expect(toggle.hasAttribute('disabled')).toBeFalsy()
	})

	test('reports a stale-head conflict with reload copy', () => {
		useSetViewedMutationMock.mockReturnValue({
			...IDLE_MUTATION,
			isError: true,
			error: new ORPCError('CONFLICT', {
				status: 409,
				message: PULL_REQUEST_STALE_COMPARISON_MESSAGE,
			}),
		} as never)

		renderFiles({ files: [changedFile('src/index.ts')] })

		expect(screen.getByRole('alert').textContent).toBe(
			'The diff changed and was reloaded.'
		)
	})

	test('prefetches the exact file-diff query from headers and tree rows except large or binary files', () => {
		const ordinary = changedFile('src/ordinary.ts')
		const large = changedFile('src/large.ts', { additions: 801, deletions: 0 })
		const binary = changedFile('assets/logo.png', { isBinary: true })

		renderFiles({ files: [ordinary, large, binary] })

		fireEvent.pointerEnter(fileHeader(ordinary.newPath))
		const ordinaryTreeRow = screen
			.getAllByTitle(ordinary.newPath)
			.map(element => element.closest('button'))
			.find(button => button && !button.hasAttribute('aria-expanded'))
		if (!ordinaryTreeRow) throw new Error('Tree row missing')
		fireEvent.focus(ordinaryTreeRow)
		fireEvent.pointerEnter(fileHeader(large.newPath))
		fireEvent.pointerEnter(fileHeader(binary.newPath))

		const expectedInput = {
			username: 'marta',
			slug: 'notes',
			number: '7',
			path: ordinary.newPath,
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
		}
		expect(prefetchQuery).toHaveBeenCalledTimes(2)
		expect(
			prefetchQuery.mock.calls.map(
				([options]) => (options as { queryKey: unknown }).queryKey
			)
		).toEqual([
			getPullRequestFileDiffQueryOptions(expectedInput).queryKey,
			getPullRequestFileDiffQueryOptions(expectedInput).queryKey,
		])
	})

	test.each([
		[false, 'smooth'],
		[true, 'auto'],
	] as const)('scrolls a selected tree file with reduced motion=%s', (reducedMotion, behavior) => {
		useReducedMotionMock.mockReturnValue(reducedMotion)
		const path = 'src/index.ts'
		renderFiles({ files: [changedFile(path)] })
		const treeRow = screen
			.getAllByTitle(path)
			.map(element => element.closest('button'))
			.find(button => button && !button.hasAttribute('aria-expanded'))
		if (!treeRow) throw new Error('Tree row missing')

		fireEvent.click(treeRow)

		expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
			behavior,
			block: 'start',
		})
	})

	test('defers offscreen diffs, fetches after intersection, and creates one observer per band', () => {
		window.IntersectionObserver =
			ControlledIntersectionObserver as unknown as typeof IntersectionObserver
		const files = [
			changedFile('src/one.ts'),
			changedFile('src/two.ts'),
			changedFile('src/three.ts'),
		]

		renderFiles({ files })

		expect(ControlledIntersectionObserver.instances).toHaveLength(3)
		expect(useFileDiffQueryMock).not.toHaveBeenCalled()

		const preloadObserver = ControlledIntersectionObserver.instances.find(
			observer => observer.rootMargin === '600px 0px'
		)
		if (!preloadObserver) throw new Error('Preload observer missing')
		act(() => preloadObserver.intersectAll())

		expect(
			useFileDiffQueryMock.mock.calls.map(([input]) => input.path)
		).toEqual(['src/one.ts', 'src/two.ts', 'src/three.ts'])
		const activeObserver = ControlledIntersectionObserver.instances.find(
			observer => observer.rootMargin === '-10% 0px -75% 0px'
		)
		if (!activeObserver) throw new Error('Active observer missing')
		act(() => activeObserver.intersectAll())
		expect(
			screen
				.getAllByTitle('src/one.ts')
				.map(element => element.closest('button'))
				.filter(button => button && !button.hasAttribute('aria-expanded'))
				.every(button => button?.getAttribute('aria-current') === 'true')
		).toBeTruthy()
	})

	test('resets expansion overrides on pair change without discarding a mounted draft', async () => {
		const first = changedFile('src/one.ts')
		const second = changedFile('src/two.ts')
		const user = userEvent.setup()
		const rendered = renderFiles({ files: [first, second] })

		await user.click(
			screen.getAllByRole('button', { name: 'Comment on updated line 1' })[0]
		)
		const composer = screen.getByRole('textbox', { name: 'Comment on line 1' })
		await user.type(composer, 'Keep this draft')
		await user.click(fileHeader(second.newPath))
		expect(fileHeader(second.newPath).getAttribute('aria-expanded')).toBe(
			'false'
		)

		const nextComparison = comparison(
			[first, second],
			NEXT_BASE_SHA,
			NEXT_HEAD_SHA
		)
		rendered.rerender(
			<PullRequestComparisonFiles
				anchorComparison={nextComparison}
				comparison={nextComparison}
				number="7"
				review={{ canSubmitReview: true, hasPendingReview: true }}
				slug="notes"
				username="marta"
			/>
		)

		expect(fileHeader(second.newPath).getAttribute('aria-expanded')).toBe(
			'true'
		)
		const preservedDraft = screen.getByRole<HTMLTextAreaElement>('textbox', {
			name: 'Comment on line 1',
		})
		expect(preservedDraft.value).toBe('Keep this draft')
	})

	test('hides viewed toggles for since-review comparisons', () => {
		useViewedFilesQueryMock.mockReturnValue({
			data: { headSha: HEAD_SHA, paths: [] },
			isSuccess: true,
			isError: false,
		} as never)

		renderFiles({
			files: [changedFile('src/index.ts')],
			isSinceReview: true,
			viewerUserId: VIEWER_USER_ID,
		})

		expect(screen.queryByRole('button', { name: MARK_VIEWED_REGEX })).toBeNull()
		expect(useViewedFilesQueryMock).toHaveBeenCalledWith(
			expect.any(Object),
			false
		)
	})
})
