import { mockRepositoryCommit } from '~/shared/mocks/repository-commit.mock'
import {
	CheckRepositoryMergeabilityResponse,
	RepositoryBlobPreviewState,
	RepositoryChangedFileStatus,
	RepositoryDiffLineKind,
	RepositoryMergeStrategy,
	RepositoryMergeStrategyUnavailableReason,
	RepositoryRefKind,
	RepositorySignatureState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import {
	toRepositoryBlob,
	toRepositoryBrowserSummary,
	toRepositoryCommitHistory,
	toRepositoryComparison,
	toRepositoryFileDiff,
	toRepositoryMergeability,
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
			commitCount: 12,
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
			commitCount: 12,
		})
	})

	test('maps missing browser summary fields to safe defaults', () => {
		expect(toRepositoryBrowserSummary({})).toEqual({
			defaultBranch: '',
			isEmpty: false,
			rootEntries: [],
			readme: undefined,
			commitCount: 0,
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
					signature: {
						state: RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_TRUSTED,
						keyId: '0123456789ABCDEF',
						fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
						primaryKeyFingerprint: 'FEDCBA9876543210FEDCBA9876543210FEDCBA98',
						signer: 'Marta <marta@example.com>',
					},
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
					signature: {
						state: 'trusted',
						keyId: '0123456789ABCDEF',
						fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
						primaryKeyFingerprint: 'FEDCBA9876543210FEDCBA9876543210FEDCBA98',
						signer: 'Marta <marta@example.com>',
					},
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
					signature: {
						state: 'unsigned',
					},
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
					signature: {
						state: 'unsigned',
					},
				},
			],
		})
	})

	test('maps signature enum states', () => {
		expect(
			toRepositoryCommitHistory({
				commits: [
					{
						signature: {
							state: RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_VALID,
						},
					},
					{
						signature: {
							state:
								RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_UNTRUSTED,
						},
					},
					{
						signature: {
							state: RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_BAD,
						},
					},
					{
						signature: {
							state:
								RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_UNKNOWN,
						},
					},
					{
						signature: {
							state:
								RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_EXPIRED,
						},
					},
					{
						signature: {
							state:
								RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_REVOKED,
						},
					},
				],
			}).commits.map(commit => commit.signature.state)
		).toEqual(['valid', 'untrusted', 'bad', 'unknown', 'expired', 'revoked'])
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
						signature: {
							state: RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_VALID,
							keyId: '0123456789ABCDEF',
						},
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
					signature: {
						state: 'valid',
						keyId: '0123456789ABCDEF',
					},
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

	test('maps comparison metadata and structured file hunks', () => {
		expect(
			toRepositoryComparison({
				baseSha: 'base',
				headSha: 'head',
				mergeBaseSha: 'merge-base',
				files: [
					{
						status:
							RepositoryChangedFileStatus.REPOSITORY_CHANGED_FILE_STATUS_RENAMED,
						oldPath: 'old.ts',
						newPath: 'new.ts',
						additions: 2,
						deletions: 1,
						isBinary: false,
					},
				],
				commits: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})
		).toMatchObject({ files: [{ status: 'renamed' }] })
		expect(
			toRepositoryFileDiff({
				file: {},
				hunks: [
					{
						header: '@@ -1 +1 @@',
						lines: [
							{
								kind: RepositoryDiffLineKind.REPOSITORY_DIFF_LINE_KIND_DELETION,
								content: 'old',
								oldLine: 1,
							},
						],
					},
				],
			})
		).toMatchObject({ hunks: [{ lines: [{ kind: 'deletion' }] }] })
	})

	test('maps unspecified and unrecognized file statuses intentionally', () => {
		expect(
			toRepositoryComparison({
				files: [
					{
						status:
							RepositoryChangedFileStatus.REPOSITORY_CHANGED_FILE_STATUS_UNSPECIFIED,
					},
					{ status: RepositoryChangedFileStatus.UNRECOGNIZED },
					{},
				],
			}).files.map(file => file.status)
		).toEqual(['modified', 'modified', 'modified'])
	})

	test('maps mergeability payloads and their omitted defaults', () => {
		expect(
			toRepositoryMergeability({
				mergeable: false,
				baseSha: 'base',
				headSha: 'head',
				mergeBaseSha: 'merge-base',
				conflictPaths: ['src/index.ts'],
				conflictPathsTruncated: true,
				conflictPathLimit: 50,
				strategyAvailability: [],
			})
		).toStrictEqual({
			mergeable: false,
			baseSha: 'base',
			headSha: 'head',
			mergeBaseSha: 'merge-base',
			conflictPaths: ['src/index.ts'],
			conflictPathsTruncated: true,
			conflictPathLimit: 50,
			strategyAvailability: undefined,
		})
		expect(toRepositoryMergeability({})).toStrictEqual({
			mergeable: false,
			baseSha: '',
			headSha: '',
			mergeBaseSha: '',
			conflictPaths: [],
			conflictPathsTruncated: false,
			conflictPathLimit: 0,
			// A git storage that answers for strategies answers for all four, so
			// anything short of that is an answer that never reached them.
			strategyAvailability: undefined,
		})
	})

	// Both directions are checked here because this is the only place the wire
	// enums and Tessera's own names are matched up.
	test('maps every strategy availability entry to its own name', () => {
		expect(
			toRepositoryMergeability({
				strategyAvailability: [
					{
						strategy:
							RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_MERGE_COMMIT,
						available: true,
						reason:
							RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_UNSPECIFIED,
					},
					{
						strategy: RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_SQUASH,
						available: false,
						reason:
							RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_CONFLICT,
					},
					{
						strategy: RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_REBASE,
						available: false,
						reason:
							RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_NOTHING_TO_REBASE,
					},
					{
						strategy:
							RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_FAST_FORWARD,
						available: false,
						reason:
							RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_ALREADY_UP_TO_DATE,
					},
				],
			}).strategyAvailability
		).toStrictEqual([
			{ strategy: 'merge_commit', available: true, reason: undefined },
			{ strategy: 'squash', available: false, reason: 'conflict' },
			{ strategy: 'rebase', available: false, reason: 'nothing_to_rebase' },
			{
				strategy: 'fast_forward',
				available: false,
				reason: 'already_up_to_date',
			},
		])
	})

	// A merge method this build cannot execute has no business being offered, and
	// inventing a name for it would put it in front of a reader. Dropping one
	// leaves the set incomplete, which is reported as no answer at all.
	test('reports no answer when an entry names an unknown strategy', () => {
		expect(
			toRepositoryMergeability({
				strategyAvailability: [
					{
						strategy:
							RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_UNSPECIFIED,
						available: true,
					},
					{ strategy: 99 as RepositoryMergeStrategy, available: true },
				],
			}).strategyAvailability
		).toBeUndefined()
	})

	// Protobuf decodes an omitted repeated field to an empty list, so a legacy
	// response is indistinguishable from a genuinely empty one by shape alone.
	// This is the actual decode, not a hand-built object.
	test('reports no answer for a decoded response from a git storage that predates strategies', () => {
		const legacy = CheckRepositoryMergeabilityResponse.decode(
			CheckRepositoryMergeabilityResponse.encode({
				mergeable: true,
				baseSha: 'base',
				headSha: 'head',
				mergeBaseSha: 'merge-base',
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 50,
				// What a git storage that predates strategies sends: nothing.
				strategyAvailability: [],
			}).finish()
		)

		expect(legacy.strategyAvailability).toStrictEqual([])
		expect(
			toRepositoryMergeability(legacy).strategyAvailability
		).toBeUndefined()
	})

	test('rejects a file diff without its required file entry', () => {
		expect(() => toRepositoryFileDiff({})).toThrow('git storage request failed')
	})
})
