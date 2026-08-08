import type {
	PullRequestChangedFile,
	PullRequestComparison as PullRequestComparisonData,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestFileDiffQuery } from '../hooks/use-pull-request-file-diff.query'
import { PullRequestComparison } from './pull-request-comparison'

vi.mock('../hooks/use-pull-request-comparison.query', () => ({
	usePullRequestComparisonQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-file-diff.query', () => ({
	usePullRequestFileDiffQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: () => ({
		data: undefined,
		isLoading: false,
		isError: false,
	}),
}))

const useComparisonQueryMock = vi.mocked(usePullRequestComparisonQuery)
const useFileDiffQueryMock = vi.mocked(usePullRequestFileDiffQuery)
const INDEX_FILE_BUTTON_NAME_REGEX = /src\/index\.ts/
const BINARY_FILE_CHANGED_REGEX = /Binary file changed/

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

const COMPARISON = {
	baseSha: 'a'.repeat(40),
	headSha: 'b'.repeat(40),
	mergeBaseSha: 'a'.repeat(40),
	commits: [
		{
			sha: 'b'.repeat(40),
			shortSha: 'bbbbbbb',
			summary: 'Add pull request diff',
			author: {
				name: 'Marta',
				email: 'marta@example.com',
				date: new Date('2026-07-11T10:00:00.000Z'),
			},
		},
	],
	files: [CHANGED_FILE],
	isTruncated: false,
	commitsTruncated: false,
	commitLimit: 500,
	fileLimit: 300,
} satisfies PullRequestComparisonData

describe(PullRequestComparison.name, () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('renders the source commit list', () => {
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="commits"
				username="marta"
			/>
		)

		expect(screen.getByText('Add pull request diff')).toBeTruthy()
		expect(screen.getByText('Marta')).toBeTruthy()
		expect(screen.getByText('bbbbbbb')).toBeTruthy()
	})

	test('names commit check status without relying on color', () => {
		useComparisonQueryMock.mockReturnValue({
			data: {
				...COMPARISON,
				commits: [
					{
						...COMPARISON.commits[0],
						checksSummary: {
							headSha: COMPARISON.commits[0].sha,
							overall: 'failure',
							counts: {
								queued: 0,
								pending: 0,
								success: 0,
								failure: 1,
								neutral: 0,
								canceled: 0,
								skipped: 0,
								timed_out: 0,
								stale: 0,
							},
							enforcement: 'advisory',
							headIsCurrent: true,
						},
					},
				],
			},
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="commits"
				username="marta"
			/>
		)

		expect(screen.getByText('1 check requires attention')).toBeTruthy()
		expect(screen.getByTitle('1 check requires attention')).toBeTruthy()
	})

	test('fetches and renders a file diff only after expansion', async () => {
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue({
			data: {
				baseSha: COMPARISON.baseSha,
				headSha: COMPARISON.headSha,
				mergeBaseSha: COMPARISON.mergeBaseSha,
				file: CHANGED_FILE,
				language: 'typescript',
				hunks: [
					{
						header: '@@ -1 +1 @@',
						lines: [
							{
								kind: 'addition',
								content: 'const answer = 42',
								darkHtml: '<span>const answer = 42</span>',
								new: {
									sha: COMPARISON.headSha,
									path: 'src/index.ts',
									line: 1,
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

		expect(useFileDiffQueryMock).not.toHaveBeenCalled()
		await user.click(
			screen.getByRole('button', { name: INDEX_FILE_BUTTON_NAME_REGEX })
		)
		expect(useFileDiffQueryMock).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes',
				number: '1',
				path: 'src/index.ts',
				expectedBaseSha: COMPARISON.baseSha,
				expectedHeadSha: COMPARISON.headSha,
			},
			true
		)
		expect(screen.getAllByText('const answer = 42')).toHaveLength(2)
		expect(screen.getByText('@@ -1 +1 @@')).toBeTruthy()
	})

	test('shows rename origins and bounded comparison notices', () => {
		useComparisonQueryMock.mockReturnValue({
			data: {
				...COMPARISON,
				commitsTruncated: true,
				isTruncated: true,
				files: [
					{
						...CHANGED_FILE,
						status: 'renamed',
						oldPath: 'src/old.ts',
						newPath: 'src/new.ts',
					},
				],
			},
			isLoading: false,
			isError: false,
		} as never)

		const { rerender } = render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		expect(screen.getByText('src/old.ts → src/new.ts')).toBeTruthy()
		expect(screen.getByText('File list truncated')).toBeTruthy()
		rerender(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="commits"
				username="marta"
			/>
		)
		expect(screen.getByText('Commit list truncated')).toBeTruthy()
	})

	test('pairs removed and added lines in a split diff', async () => {
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue({
			data: {
				baseSha: COMPARISON.baseSha,
				headSha: COMPARISON.headSha,
				mergeBaseSha: COMPARISON.mergeBaseSha,
				file: CHANGED_FILE,
				language: 'typescript',
				hunks: [
					{
						header: '@@ -1,2 +1,3 @@',
						lines: [
							{
								kind: 'deletion',
								content: 'if (ready === false)',
								old: {
									sha: COMPARISON.baseSha,
									path: 'src/index.ts',
									line: 1,
									side: 'left',
								},
							},
							{
								kind: 'addition',
								content: 'if (ready === true)',
								new: {
									sha: COMPARISON.headSha,
									path: 'src/index.ts',
									line: 1,
									side: 'right',
								},
							},
							{
								kind: 'addition',
								content: 'runTask()',
								new: {
									sha: COMPARISON.headSha,
									path: 'src/index.ts',
									line: 2,
									side: 'right',
								},
							},
							{
								kind: 'context',
								content: 'finish()',
								old: {
									sha: COMPARISON.baseSha,
									path: 'src/index.ts',
									line: 2,
									side: 'left',
								},
								new: {
									sha: COMPARISON.headSha,
									path: 'src/index.ts',
									line: 3,
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
		} as never)
		const user = userEvent.setup()
		const { container } = render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		await user.click(
			screen.getByRole('button', { name: INDEX_FILE_BUTTON_NAME_REGEX })
		)

		expect(
			container.querySelector('[data-side="left"][data-kind="deletion"]')
				?.textContent
		).toContain('if (ready === false)')
		expect(
			container.querySelector('[data-side="right"][data-kind="addition"]')
				?.textContent
		).toContain('if (ready === true)')
		expect(
			container.querySelector('[data-side="left"][data-empty="true"]')
		).toBeTruthy()
		expect(container.querySelector('[data-diff-code]')?.className).toContain(
			'[font-variant-ligatures:none]'
		)
		expect(
			container.querySelector('[data-side="left"][data-kind="context"]')
				?.textContent
		).toContain('finish()')
		expect(
			container.querySelector('[data-side="right"][data-kind="context"]')
				?.textContent
		).toContain('finish()')
	})

	test('renders binary and loading fallbacks', async () => {
		useComparisonQueryMock.mockReturnValue({
			data: COMPARISON,
			isLoading: false,
			isError: false,
		} as never)
		useFileDiffQueryMock.mockReturnValue({
			data: {
				baseSha: COMPARISON.baseSha,
				headSha: COMPARISON.headSha,
				mergeBaseSha: COMPARISON.mergeBaseSha,
				file: { ...CHANGED_FILE, isBinary: true },
				hunks: [],
				isTruncated: false,
				patchLimitBytes: 2_097_152,
			},
			isLoading: false,
			isError: false,
		} as never)
		const user = userEvent.setup()
		const { rerender } = render(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="files"
				username="marta"
			/>
		)

		await user.click(
			screen.getByRole('button', { name: INDEX_FILE_BUTTON_NAME_REGEX })
		)
		expect(screen.getByText(BINARY_FILE_CHANGED_REGEX)).toBeTruthy()

		useComparisonQueryMock.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		} as never)
		rerender(
			<PullRequestComparison
				number="1"
				slug="notes"
				tab="commits"
				username="marta"
			/>
		)
		expect(document.querySelector('.animate-pulse')).toBeTruthy()
	})
})
