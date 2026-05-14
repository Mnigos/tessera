import {
	type GetRepositoryBlobResponse,
	type GetRepositoryBrowserSummaryResponse,
	type GetRepositoryRawBlobResponse,
	type GetRepositoryTreeResponse,
	RepositoryBlobPreviewState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import {
	toRepositoryBlob,
	toRepositoryBrowserSummary,
	toRepositoryRawBlob,
	toRepositoryTree,
} from './git-storage.mappers'

describe('git storage mappers', () => {
	test('maps browser summaries without exposing storage fields', () => {
		const response = {
			defaultBranch: 'main',
			isEmpty: false,
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_DIRECTORY,
					sizeBytes: '0',
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'blob123',
				content: new TextEncoder().encode('# Tessera'),
				isTruncated: true,
			},
		} as unknown as GetRepositoryBrowserSummaryResponse

		expect(toRepositoryBrowserSummary(response)).toEqual({
			defaultBranch: 'main',
			isEmpty: false,
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'blob123',
				content: '# Tessera',
				isTruncated: true,
			},
		})
	})

	test('maps missing browser summary fields to safe defaults', () => {
		expect(toRepositoryBrowserSummary({})).toEqual({
			defaultBranch: '',
			isEmpty: false,
			rootEntries: [],
			readme: undefined,
		})
	})

	test('maps repository tree entries and unknown entry kinds', () => {
		const response = {
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE,
					sizeBytes: '24',
					path: 'src/index.ts',
					mode: '100644',
				},
				{
					name: 'unknown',
					objectId: 'unknown123',
					kind: undefined,
				},
			],
		} as unknown as GetRepositoryTreeResponse

		expect(toRepositoryTree(response)).toEqual({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 24,
					path: 'src/index.ts',
					mode: '100644',
				},
				{
					name: 'unknown',
					objectId: 'unknown123',
					kind: 'unknown',
					sizeBytes: 0,
					path: '',
					mode: '',
				},
			],
		})
	})

	test('maps blob preview states', () => {
		const textResponse = {
			objectId: 'blob123',
			state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TEXT,
			text: 'hello',
			sizeBytes: '5',
			previewLimitBytes: '1048576',
		} as unknown as GetRepositoryBlobResponse
		const tooLargeResponse = {
			objectId: 'blob123',
			state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TOO_LARGE,
			sizeBytes: 2_097_152,
			previewLimitBytes: '1048576',
		} as unknown as GetRepositoryBlobResponse

		expect(toRepositoryBlob(textResponse)).toEqual({
			objectId: 'blob123',
			sizeBytes: 5,
			preview: { type: 'text', content: 'hello' },
		})

		expect(
			toRepositoryBlob({
				objectId: 'blob123',
				state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_BINARY,
				sizeBytes: 10,
			})
		).toEqual({
			objectId: 'blob123',
			sizeBytes: 10,
			preview: { type: 'binary' },
		})

		expect(toRepositoryBlob(tooLargeResponse)).toEqual({
			objectId: 'blob123',
			sizeBytes: 2_097_152,
			preview: { type: 'tooLarge', previewLimitBytes: 1_048_576 },
		})
	})

	test('maps raw blob bytes without decoding content', () => {
		const content = new Uint8Array([0, 1, 2, 255])
		const response = {
			objectId: 'blob123',
			content,
			sizeBytes: '4',
		} as unknown as GetRepositoryRawBlobResponse

		expect(toRepositoryRawBlob(response)).toEqual({
			objectId: 'blob123',
			content,
			sizeBytes: 4,
		})
	})
})
