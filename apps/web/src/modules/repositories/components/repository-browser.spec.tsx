/// <reference types="vitest/globals" />

import { repositorySchema } from '@repo/contracts'
import { render, screen, within } from '@testing-library/react'
import type { RepositoryBlobResult } from '../hooks/use-repository-blob.query'
import { useRepositoryBlobQuery } from '../hooks/use-repository-blob.query'
import type { RepositoryTreeResult } from '../hooks/use-repository-tree.query'
import { useRepositoryTreeQuery } from '../hooks/use-repository-tree.query'
import { RepositoryBlobPreview } from './repository-blob-preview'
import { RepositoryTreeBrowser } from './repository-tree-browser'

vi.mock('../hooks/use-repository-tree.query', () => ({
	useRepositoryTreeQuery: vi.fn(),
}))

vi.mock('../hooks/use-repository-blob.query', () => ({
	useRepositoryBlobQuery: vi.fn(),
}))

const treeQueryMock = vi.mocked(useRepositoryTreeQuery)
const blobQueryMock = vi.mocked(useRepositoryBlobQuery)

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
} satisfies RepositoryTreeResult

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
} satisfies RepositoryBlobResult

describe('Repository browser components', () => {
	afterEach(() => {
		vi.resetAllMocks()
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

	test('renders binary and large blob states', () => {
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
	})

	test('renders not-found states when queries fail', () => {
		treeQueryMock.mockReturnValue(getQueryResult({ isError: true }))
		blobQueryMock.mockReturnValue(getQueryResult({ isError: true }))

		const { rerender } = render(
			<RepositoryTreeBrowser
				path="missing"
				refName="main"
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
				refName="main"
				slug="tessera-notes"
				username="mnigos"
			/>
		)

		expect(screen.getByRole('heading', { name: 'File not found' })).toBeTruthy()
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
		ReturnType<typeof useRepositoryBlobQuery>
}
