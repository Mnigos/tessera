import type { PullRequestFileDiff } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import { PullRequestDiffSelectionProvider } from './pull-request-diff-selection-context'
import { PullRequestFileDiffView } from './pull-request-file-diff'

vi.mock('@/modules/auth/hooks/use-auth', () => ({
	useAuth: () => ({ user: undefined }),
}))

vi.mock('../hooks/use-pull-request-file-diff.query', () => ({
	usePullRequestFileDiffQuery: vi.fn(),
}))

vi.mock('../hooks/use-create-pull-request-thread.mutation', () => ({
	useCreatePullRequestThreadMutation: vi.fn(),
}))

const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const FILE_A = 'src/a.ts'
const FILE_B = 'src/b.ts'
const PERMISSIONS: PullRequestThreadPermissions = {
	canComment: true,
	canResolveAnyThread: false,
	canDeleteAnyComment: false,
}
const useFileDiffQueryMock = vi.mocked(usePullRequestFileDiffQuery)
const useCreateThreadMutationMock = vi.mocked(
	useCreatePullRequestThreadMutation
)

function fileDiff(path: string, firstLine: number): PullRequestFileDiff {
	return {
		baseSha: BASE_SHA,
		headSha: HEAD_SHA,
		mergeBaseSha: BASE_SHA,
		file: {
			status: 'modified',
			oldPath: path,
			newPath: path,
			baseBlobId: 'base-blob',
			headBlobId: 'head-blob',
			additions: 3,
			deletions: 0,
			isBinary: false,
		},
		language: 'typescript',
		hunks: [
			{
				header: `@@ -${firstLine},3 +${firstLine},3 @@`,
				lines: [0, 1, 2].map(offset => ({
					kind: 'addition' as const,
					content: `${path} line ${firstLine + offset}`,
					new: {
						sha: HEAD_SHA,
						path,
						line: firstLine + offset,
						side: 'right' as const,
					},
				})),
			},
		],
		isTruncated: false,
		patchLimitBytes: 2_097_152,
	}
}

function FileView({ path }: Readonly<{ path: string }>) {
	return (
		<PullRequestFileDiffView
			anchorableSides={['right']}
			anchorComparison={{ baseSha: BASE_SHA, headSha: HEAD_SHA }}
			expectedBaseSha={BASE_SHA}
			expectedHeadSha={HEAD_SHA}
			number="1"
			path={path}
			permissions={PERMISSIONS}
			slug="notes"
			threads={[]}
			username="marta"
		/>
	)
}

function renderFileViews() {
	return render(
		<PullRequestDiffSelectionProvider>
			<FileView path={FILE_A} />
			<FileView path={FILE_B} />
		</PullRequestDiffSelectionProvider>
	)
}

describe(PullRequestDiffSelectionProvider.name, () => {
	const mutate = vi.fn()

	beforeEach(() => {
		useFileDiffQueryMock.mockImplementation(
			input =>
				({
					data:
						input.path === FILE_A ? fileDiff(FILE_A, 1) : fileDiff(FILE_B, 10),
					isLoading: false,
					isError: false,
				}) as never
		)
		useCreateThreadMutationMock.mockReturnValue({
			error: undefined,
			isPending: false,
			mutate,
		} as never)
	})

	test('keeps only the latest file selection and composer active', () => {
		const { container } = renderFileViews()

		fireEvent.click(
			screen.getByRole('button', { name: 'Comment on updated line 1' })
		)
		expect(
			screen.getByRole('textbox', { name: 'Comment on line 1' })
		).toBeTruthy()

		fireEvent.click(
			screen.getByRole('button', { name: 'Comment on updated line 10' })
		)

		expect(
			screen.queryByRole('textbox', { name: 'Comment on line 1' })
		).toBeNull()
		expect(
			screen.getByRole('textbox', { name: 'Comment on line 10' })
		).toBeTruthy()
		expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1)
	})

	test('commits a drag when pointer up occurs on the window', () => {
		renderFileViews()
		const start = screen.getByRole('button', {
			name: 'Comment on updated line 1',
		})
		const end = screen.getByRole('button', {
			name: 'Comment on updated line 3',
		})

		fireEvent.pointerDown(start, { buttons: 1, pointerId: 7 })
		fireEvent.pointerEnter(end, { buttons: 1, pointerId: 7 })
		expect(
			screen.queryByRole('textbox', { name: 'Comment on lines 1–3' })
		).toBeNull()

		fireEvent.pointerUp(window, { buttons: 0, pointerId: 7 })

		expect(
			screen.getByRole('textbox', { name: 'Comment on lines 1–3' })
		).toBeTruthy()
	})

	test('cancels a drag that crosses into another file', () => {
		const { container } = renderFileViews()

		fireEvent.pointerDown(
			screen.getByRole('button', { name: 'Comment on updated line 1' }),
			{ buttons: 1, pointerId: 7 }
		)
		fireEvent.pointerEnter(
			screen.getByRole('button', { name: 'Comment on updated line 10' }),
			{ buttons: 1, pointerId: 7 }
		)
		fireEvent.pointerUp(window, { buttons: 0, pointerId: 7 })

		expect(screen.queryByRole('textbox')).toBeNull()
		expect(container.querySelector('[data-selected="true"]')).toBeNull()
	})

	test('renders and posts an ordered range with the end-line excerpt', () => {
		const { container } = renderFileViews()

		fireEvent.click(
			screen.getByRole('button', { name: 'Comment on updated line 1' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Comment on updated line 3' }),
			{ shiftKey: true }
		)

		expect(
			screen.getByRole('heading', { name: 'Comment on lines 1–3' })
		).toBeTruthy()
		expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(3)

		const composer = screen.getByRole('textbox', {
			name: 'Comment on lines 1–3',
		})
		fireEvent.change(composer, { target: { value: 'Range note' } })
		fireEvent.submit(composer.closest('form') ?? composer)

		expect(mutate).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				body: 'Range note',
				anchor: {
					path: FILE_A,
					side: 'right',
					startLine: 1,
					endLine: 3,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: `${FILE_A} line 3`,
				},
			},
			expect.any(Object)
		)
	})

	test('clears the composer and selected rows on Escape', () => {
		const { container } = renderFileViews()
		const lineButton = screen.getByRole('button', {
			name: 'Comment on updated line 2',
		})

		fireEvent.click(lineButton)
		expect(
			screen.getByRole('textbox', { name: 'Comment on line 2' })
		).toBeTruthy()
		fireEvent.keyDown(lineButton, { key: 'Escape' })

		expect(screen.queryByRole('textbox')).toBeNull()
		expect(container.querySelector('[data-selected="true"]')).toBeNull()
	})
})
