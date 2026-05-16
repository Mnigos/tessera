import { mockRepositoryCommit } from '~/shared/mocks/repository-commit.mock'
import {
	RepositoryBlobPreviewState,
	RepositoryRefKind,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import {
	toRepositoryBlob,
	toRepositoryBrowserSummary,
	toRepositoryCommitHistory,
	toRepositoryRawBlob,
	toRepositoryRefs,
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
					sizeBytes: 0,
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
		}

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
					sizeBytes: 24,
					path: 'src/index.ts',
					mode: '100644',
				},
				{
					name: 'unknown',
					objectId: 'unknown123',
					kind: undefined,
				},
			],
		}

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
			sizeBytes: 5,
			previewLimitBytes: 1_048_576,
		}
		const tooLargeResponse = {
			objectId: 'blob123',
			state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TOO_LARGE,
			sizeBytes: 2_097_152,
			previewLimitBytes: 1_048_576,
		}

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
			sizeBytes: 4,
		}

		expect(toRepositoryRawBlob(response)).toEqual({
			objectId: 'blob123',
			content,
			sizeBytes: 4,
		})
	})

	test('maps commit history identity dates', () => {
		const response = {
			commits: [
				{
					...mockRepositoryCommit,
					summary: 'Add commit history',
					author: {
						...mockRepositoryCommit.author,
						email: 'marta',
					},
				},
				{
					sha: 'fedcba0987654321',
					shortSha: 'fedcba0',
					summary: 'Initial commit',
					author: undefined,
					committer: undefined,
				},
			],
		}

		expect(toRepositoryCommitHistory(response)).toEqual({
			commits: [
				{
					...mockRepositoryCommit,
					summary: 'Add commit history',
					author: {
						...mockRepositoryCommit.author,
						email: 'marta',
					},
				},
				{
					sha: 'fedcba0987654321',
					shortSha: 'fedcba0',
					summary: 'Initial commit',
					author: undefined,
					committer: undefined,
				},
			],
		})
	})

	test('maps missing commit history fields to safe defaults', () => {
		expect(
			toRepositoryCommitHistory({
				commits: [{}],
			})
		).toEqual({
			commits: [
				{
					sha: '',
					shortSha: '',
					summary: '',
					author: undefined,
					committer: undefined,
				},
			],
		})
	})

	test('maps repository refs into branch and tag groups', () => {
		expect(
			toRepositoryRefs({
				refs: [
					{
						kind: RepositoryRefKind.REPOSITORY_REF_KIND_BRANCH,
						displayName: 'main',
						qualifiedName: 'refs/heads/main',
						commitId: 'abc123',
						isDefaultBranch: true,
					},
					{
						kind: RepositoryRefKind.REPOSITORY_REF_KIND_TAG,
						displayName: 'v1.0.0',
						qualifiedName: 'refs/tags/v1.0.0',
						commitId: 'def456',
						isDefaultBranch: false,
					},
				],
			})
		).toEqual({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'abc123',
				},
			],
			tags: [
				{
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'def456',
				},
			],
		})
	})

	test('maps missing repository refs to empty lists', () => {
		expect(toRepositoryRefs({})).toEqual({
			branches: [],
			tags: [],
		})
	})
})
