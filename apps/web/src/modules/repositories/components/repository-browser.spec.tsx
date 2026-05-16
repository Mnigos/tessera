import {
	type RepositoryBlob,
	type RepositoryBrowserSummary,
	type RepositoryCommitHistory as RepositoryCommitHistoryResult,
	type RepositoryTree,
	repositorySchema,
} from '@repo/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useRepositoryBlobQuery } from '../hooks/use-repository-blob.query'
import { useRepositoryBrowserSummaryQuery } from '../hooks/use-repository-browser-summary.query'
import { useRepositoryCommitsQuery } from '../hooks/use-repository-commits.query'
import { useRepositoryTreeQuery } from '../hooks/use-repository-tree.query'
import { RepositoryBlobPreview } from './repository-blob-preview'
import { getBlobHref, getTreeHref } from './repository-browser-breadcrumbs'
import { RepositoryCommitHistory } from './repository-commit-history'
import { RepositoryRefSelector } from './repository-ref-selector'
import { RepositoryTreeBrowser } from './repository-tree-browser'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		to: string
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))

vi.mock('../hooks/use-repository-tree.query', () => ({
	useRepositoryTreeQuery: vi.fn(),
}))

vi.mock('../hooks/use-repository-blob.query', () => ({
	useRepositoryBlobQuery: vi.fn(),
}))

vi.mock('../hooks/use-repository-browser-summary.query', () => ({
	useRepositoryBrowserSummaryQuery: vi.fn(),
}))

vi.mock('../hooks/use-repository-commits.query', () => ({
	useRepositoryCommitsQuery: vi.fn(),
}))

const treeQueryMock = vi.mocked(useRepositoryTreeQuery)
const blobQueryMock = vi.mocked(useRepositoryBlobQuery)
const summaryQueryMock = vi.mocked(useRepositoryBrowserSummaryQuery)
const commitsQueryMock = vi.mocked(useRepositoryCommitsQuery)

const baseTree = {
	owner: { username: 'mnigos' },
	repository: repositorySchema.parse({
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08',
		slug: 'tessera-notes',
		name: 'Tessera Notes',
		visibility: 'public',
		defaultBranch: 'main',
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	}),
	ref: 'main',
	path: 'src/modules',
	commitId: 'commit-main',
	entries: [
		{
			name: 'repositories',
			objectId: 'tree-repositories',
			kind: 'directory',
			sizeBytes: 0,
			path: 'src/modules/repositories',
			mode: '040000',
		},
		{
			name: 'index.ts',
			objectId: 'blob-index',
			kind: 'file',
			sizeBytes: 96,
			path: 'src/modules/index.ts',
			mode: '100644',
		},
		{
			name: 'vendor',
			objectId: 'submodule-vendor',
			kind: 'submodule',
			sizeBytes: 0,
			path: 'src/modules/vendor',
			mode: '160000',
		},
		{
			name: 'mystery',
			objectId: 'unknown-mystery',
			kind: 'unknown',
			sizeBytes: 0,
			path: 'src/modules/mystery',
			mode: '000000',
		},
	],
} satisfies RepositoryTree

const baseBlob = {
	owner: { username: 'mnigos' },
	repository: repositorySchema.parse({
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08',
		slug: 'tessera-notes',
		name: 'Tessera Notes',
		visibility: 'public',
		defaultBranch: 'main',
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	}),
	ref: 'main',
	path: 'src/modules/index.ts',
	name: 'index.ts',
	objectId: 'blob-index',
	sizeBytes: 42,
	preview: {
		type: 'text',
		content: 'export const moduleName = "repositories"\n',
	},
} satisfies RepositoryBlob

const baseCommits = {
	owner: { username: 'mnigos' },
	repository: repositorySchema.parse({
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08',
		slug: 'tessera-notes',
		name: 'Tessera Notes',
		visibility: 'public',
		defaultBranch: 'main',
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
	}),
	ref: 'main',
	commits: [
		{
			sha: 'b17a8d52a7d9477c8fb0ebdf7f4aafadf404da13',
			shortSha: 'b17a8d5',
			summary: 'Add repository browser',
			author: {
				name: 'Marek Nigos',
				email: 'marek@example.com',
				date: '2026-01-02T10:30:00.000Z',
			},
			committer: {
				name: 'Marek Nigos',
				email: 'marek@example.com',
				date: '2026-01-02T10:30:00.000Z',
			},
		},
		{
			sha: 'c28fb983d8b441f2b8731999f9f690fc14787dd4',
			shortSha: 'c28fb98',
			summary: 'Merge remote changes',
			author: {
				name: 'Ada Lovelace',
				email: 'ada@example.com',
				date: '2026-01-03T11:45:00.000Z',
			},
			committer: {
				name: 'Grace Hopper',
				email: 'grace@example.com',
				date: '2026-01-03T12:00:00.000Z',
			},
		},
	],
} satisfies RepositoryCommitHistoryResult

const baseSummary = {
	repository: baseTree.repository,
	owner: baseTree.owner,
	defaultBranch: 'main',
	branches: [
		{
			type: 'branch',
			name: 'main',
			qualifiedName: 'refs/heads/main',
			target: 'commit-main',
		},
		{
			type: 'branch',
			name: 'feature/browser-ref-selector',
			qualifiedName: 'refs/heads/feature/browser-ref-selector',
			target: 'commit-feature',
		},
	],
	tags: [
		{
			type: 'tag',
			name: 'v1.0.0',
			qualifiedName: 'refs/tags/v1.0.0',
			target: 'commit-release',
		},
	],
	isEmpty: false,
	rootEntries: baseTree.entries,
} satisfies RepositoryBrowserSummary

describe('Repository browser components', () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	beforeEach(() => {
		summaryQueryMock.mockReturnValue(
			getQueryResult<RepositoryBrowserSummary>({ data: baseSummary })
		)
	})

	test('renders breadcrumbs with repository root and parent directory links', () => {
		treeQueryMock.mockReturnValue(getQueryResult({ data: baseTree }))

		render(
			<RepositoryTreeBrowser
				path="src/modules"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(
			screen
				.getByRole('link', { name: 'mnigos/tessera-notes' })
				.getAttribute('href')
		).toBe('/mnigos/tessera-notes')
		expect(
			screen.getByRole('link', { name: 'main' }).getAttribute('href')
		).toBe('/mnigos/tessera-notes/tree/main/')
		expect(screen.getByRole('link', { name: 'src' }).getAttribute('href')).toBe(
			'/mnigos/tessera-notes/tree/main/src'
		)
		expect(
			screen.getByRole('link', { name: 'modules' }).getAttribute('href')
		).toBe('/mnigos/tessera-notes/tree/main/src/modules')
	})

	test('renders nested tree entries with directory and blob links', () => {
		treeQueryMock.mockReturnValue(getQueryResult({ data: baseTree }))

		render(
			<RepositoryTreeBrowser
				path="src/modules"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		const rows = screen.getAllByTestId('nested-file-tree-row')
		const directoryRow = rows.find(
			row => row.dataset.entryName === 'repositories'
		)
		const fileRow = rows.find(row => row.dataset.entryName === 'index.ts')
		const submoduleRow = rows.find(row => row.dataset.entryName === 'vendor')
		const unknownRow = rows.find(row => row.dataset.entryName === 'mystery')

		expect(directoryRow?.getAttribute('href')).toBe(
			'/mnigos/tessera-notes/tree/main/src/modules/repositories'
		)
		expect(
			within(directoryRow as HTMLElement).getByText('directory')
		).toBeTruthy()
		expect(fileRow?.getAttribute('href')).toBe(
			'/mnigos/tessera-notes/blob/main/src/modules/index.ts'
		)
		expect(within(fileRow as HTMLElement).getByText('96 B')).toBeTruthy()
		expect(submoduleRow?.getAttribute('href')).toBeNull()
		expect(
			within(submoduleRow as HTMLElement).getByText('submodule')
		).toBeTruthy()
		expect(unknownRow?.getAttribute('href')).toBeNull()
		expect(within(unknownRow as HTMLElement).getByText('unknown')).toBeTruthy()
	})

	test('preserves tree and blob paths when building links for qualified refs', () => {
		expect(
			getTreeHref(
				'mnigos',
				'tessera-notes',
				'refs/heads/feature/browser-ref-selector',
				'src/modules'
			)
		).toBe(
			'/mnigos/tessera-notes/tree/refs%2Fheads%2Ffeature%2Fbrowser-ref-selector/src/modules'
		)
		expect(
			getBlobHref(
				'mnigos',
				'tessera-notes',
				'refs/tags/v1.0.0',
				'src/modules/index.ts'
			)
		).toBe(
			'/mnigos/tessera-notes/blob/refs%2Ftags%2Fv1.0.0/src/modules/index.ts'
		)
	})

	test('switches branch and tag values from the repository ref selector', async () => {
		const user = userEvent.setup()
		const onSelectedRefChange = vi.fn()

		render(
			<RepositoryRefSelector
				onSelectedRefChange={onSelectedRefChange}
				refs={[
					{
						kind: 'branch',
						name: 'main',
						qualifiedName: 'refs/heads/main',
					},
					{
						kind: 'branch',
						name: 'feature/browser-ref-selector',
						qualifiedName: 'refs/heads/feature/browser-ref-selector',
					},
					{
						kind: 'tag',
						name: 'v1.0.0',
						qualifiedName: 'refs/tags/v1.0.0',
					},
				]}
				selectedRef="refs/heads/main"
			/>
		)

		await user.click(screen.getByRole('combobox', { name: 'Repository ref' }))
		await user.click(
			screen.getByRole('option', { name: 'feature/browser-ref-selector' })
		)
		await user.click(screen.getByRole('combobox', { name: 'Repository ref' }))
		await user.click(screen.getByRole('option', { name: 'v1.0.0' }))

		expect(onSelectedRefChange).toHaveBeenNthCalledWith(
			1,
			'refs/heads/feature/browser-ref-selector'
		)
		expect(onSelectedRefChange).toHaveBeenNthCalledWith(2, 'refs/tags/v1.0.0')
	})

	test('renders text blob previews', () => {
		blobQueryMock.mockReturnValue(getQueryResult({ data: baseBlob }))

		render(
			<RepositoryBlobPreview
				path="src/modules/index.ts"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getAllByText('index.ts')).toHaveLength(2)
		expect(
			screen.getByText('export const moduleName = "repositories"')
		).toBeTruthy()
		expect(screen.getByText('42 B')).toBeTruthy()
	})

	test('renders highlighted blob rows with line numbers and raw action', () => {
		blobQueryMock.mockReturnValue(
			getQueryResult({
				data: {
					...baseBlob,
					path: 'src/modules/index.ts',
					preview: {
						type: 'text',
						content: 'export const moduleName = "repositories"\n',
						language: 'typescript',
						highlighted: {
							startLine: 12,
							lines: [
								{
									number: 12,
									html: '<span class="hljs-keyword">export</span> const moduleName = <span class="hljs-string">"repositories"</span>',
								},
								{
									number: 13,
									html: '<span class="hljs-comment">// next line</span>',
								},
							],
						},
					},
				},
			})
		)

		render(
			<RepositoryBlobPreview
				path="src/modules/index.ts"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		const rows = screen.getAllByTestId('repository-blob-code-row')

		expect(rows).toHaveLength(2)
		expect(rows[0]?.dataset.lineNumber).toBe('12')
		expect(rows[0]?.dataset.path).toBe('src/modules/index.ts')
		expect(rows[0]?.dataset.ref).toBe('main')
		expect(within(rows[0] as HTMLElement).getByText('12')).toBeTruthy()
		expect(screen.getByText('export')).toBeTruthy()
		expect(screen.getByText('"repositories"')).toBeTruthy()
		expect(screen.getByText('typescript')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Raw' }).getAttribute('href')).toBe(
			'/repositories/mnigos/tessera-notes/raw/main?path=src%2Fmodules%2Findex.ts'
		)
	})

	test('renders plain text fallback rows with line numbers', () => {
		blobQueryMock.mockReturnValue(
			getQueryResult({
				data: {
					...baseBlob,
					preview: {
						type: 'text',
						content: 'first line\nsecond line\n',
					},
				},
			})
		)

		render(
			<RepositoryBlobPreview
				path="src/modules/index.ts"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		const rows = screen.getAllByTestId('repository-blob-code-row')

		expect(rows).toHaveLength(2)
		expect(within(rows[0] as HTMLElement).getByText('1')).toBeTruthy()
		expect(within(rows[0] as HTMLElement).getByText('first line')).toBeTruthy()
		expect(within(rows[1] as HTMLElement).getByText('2')).toBeTruthy()
		expect(within(rows[1] as HTMLElement).getByText('second line')).toBeTruthy()
	})

	test('renders binary and large blob states with raw actions', () => {
		blobQueryMock.mockReturnValue(
			getQueryResult({ data: { ...baseBlob, preview: { type: 'binary' } } })
		)

		const { rerender } = render(
			<RepositoryBlobPreview
				path="dist/app.bin"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getByRole('heading', { name: 'Binary file' })).toBeTruthy()
		expect(
			screen.getByText('This file cannot be previewed as text.')
		).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Raw' })).toBeTruthy()

		blobQueryMock.mockReturnValue(
			getQueryResult({
				data: {
					...baseBlob,
					preview: { type: 'tooLarge', previewLimitBytes: 1_048_576 },
				},
			})
		)

		rerender(
			<RepositoryBlobPreview
				path="logs/archive.txt"
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(
			screen.getByRole('heading', { name: 'File is too large to preview' })
		).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Raw' })).toBeTruthy()
	})

	test('renders not-found states when invalid refs fail to load', () => {
		treeQueryMock.mockReturnValue(getQueryResult({ isError: true }))
		blobQueryMock.mockReturnValue(getQueryResult({ isError: true }))

		const { rerender } = render(
			<RepositoryTreeBrowser
				path="missing"
				refName="refs/heads/missing"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(
			screen.getByRole('heading', { name: 'Directory not found' })
		).toBeTruthy()

		rerender(
			<RepositoryBlobPreview
				path="missing.txt"
				refName="refs/tags/missing"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getByRole('heading', { name: 'File not found' })).toBeTruthy()
	})

	test('renders commit history loading, error, and empty states', () => {
		commitsQueryMock.mockReturnValue(getQueryResult({ isLoading: true }))

		const { rerender } = render(
			<RepositoryCommitHistory
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getByRole('heading', { name: 'Commit history' })).toBeTruthy()
		expect(screen.getByText('main')).toBeTruthy()

		commitsQueryMock.mockReturnValue(getQueryResult({ isError: true }))

		rerender(
			<RepositoryCommitHistory
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(
			screen.getByRole('heading', { name: 'Commits not found' })
		).toBeTruthy()
		expect(
			screen.getByText('The commit history for this ref could not be loaded.')
		).toBeTruthy()

		commitsQueryMock.mockReturnValue(
			getQueryResult({ data: { ...baseCommits, commits: [] } })
		)

		rerender(
			<RepositoryCommitHistory
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getByRole('heading', { name: 'No commits' })).toBeTruthy()
		expect(
			screen.getByText('This ref does not have any commits yet.')
		).toBeTruthy()
	})

	test('renders commit history rows with author and useful committer metadata', () => {
		commitsQueryMock.mockReturnValue(getQueryResult({ data: baseCommits }))

		render(
			<RepositoryCommitHistory
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		const rows = screen.getAllByTestId('repository-commit-row')

		expect(rows).toHaveLength(2)
		expect(within(rows[0] as HTMLElement).getByText('b17a8d5')).toBeTruthy()
		expect(
			within(rows[0] as HTMLElement).getByText('Add repository browser')
		).toBeTruthy()
		expect(
			within(rows[0] as HTMLElement).getByText(
				'Marek Nigos <marek@example.com>'
			)
		).toBeTruthy()
		expect(within(rows[0] as HTMLElement).queryByText('Committed')).toBeNull()
		expect(within(rows[1] as HTMLElement).getByText('c28fb98')).toBeTruthy()
		expect(
			within(rows[1] as HTMLElement).getByText('Merge remote changes')
		).toBeTruthy()
		expect(
			within(rows[1] as HTMLElement).getByText('Ada Lovelace <ada@example.com>')
		).toBeTruthy()
		expect(
			within(rows[1] as HTMLElement).getByText(
				'Grace Hopper <grace@example.com>'
			)
		).toBeTruthy()
		expect(within(rows[1] as HTMLElement).getByText('Committed')).toBeTruthy()
	})
})

interface QueryResultOptions<TData> {
	data?: TData
	isLoading?: boolean
	isError?: boolean
}

function getQueryResult<TData>({
	data,
	isLoading = false,
	isError = false,
}: QueryResultOptions<TData>) {
	return {
		data,
		isLoading,
		isError,
	} as ReturnType<typeof useRepositoryTreeQuery> &
		ReturnType<typeof useRepositoryBlobQuery> &
		ReturnType<typeof useRepositoryBrowserSummaryQuery> &
		ReturnType<typeof useRepositoryCommitsQuery>
}
