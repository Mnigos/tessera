import type { RepositoryId } from '@repo/domain'
import type { TrustedGpgKey } from './generated/tessera/git/v1/git_storage'

export interface GitStorageCreateRepositoryParams {
	repositoryId: RepositoryId
}

export interface GitStorageCreateRepositoryResult {
	storagePath: string
}

export interface GitStorageImportRepositoryParams {
	accessToken?: string
	defaultBranchHint?: string
	repositoryId: RepositoryId
	sourceUrl: string
	storagePath: string
}

export interface GitStorageImportRepositoryResult {
	defaultBranch: string
	storagePath: string
}

export interface GitStoragePushRepositoryMirrorParams {
	accessToken?: string
	repositoryId: RepositoryId
	storagePath: string
	targetUrl: string
}

export interface GitStorageGetRepositoryBrowserSummaryParams {
	defaultBranch: string
	ref?: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageListRepositoryRefsParams {
	repositoryId: RepositoryId
	storagePath: string
	trustedGpgKeys: GitStorageTrustedGpgKey[]
}

export interface GitStorageGetRepositoryTreeParams {
	path: string
	ref: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageGetRepositoryBlobParams {
	objectId: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageGetRepositoryRawBlobParams {
	objectId: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageListRepositoryCommitsParams {
	limit: number | undefined
	ref: string
	repositoryId: RepositoryId
	storagePath: string
	trustedGpgKeys: GitStorageTrustedGpgKey[]
}

export interface GitStorageCompareRepositoryRefsParams {
	baseRef: string
	headRef: string
	repositoryId: RepositoryId
	storagePath: string
}

export interface GitStorageGetRepositoryFileDiffParams
	extends GitStorageCompareRepositoryRefsParams {
	path: string
}

export interface GitStorageMergeRepositoryRefsParams
	extends GitStorageCompareRepositoryRefsParams {
	authorEmail: string
	authorName: string
	expectedBaseSha: string
	expectedHeadSha: string
	message: string
	operationId: string
}

export type GitStorageCheckRepositoryMergeabilityParams =
	GitStorageCompareRepositoryRefsParams

export type GitStorageTrustedGpgKey = TrustedGpgKey

export interface GitStorageRepositoryTreeEntry {
	kind: 'directory' | 'file' | 'submodule' | 'symlink' | 'unknown'
	mode: string
	name: string
	objectId: string
	path: string
	sizeBytes: number
}

export interface GitStorageRepositoryReadme {
	content: string
	filename: string
	isTruncated: boolean
	objectId: string
}

export interface GitStorageRepositoryBrowserSummary {
	defaultBranch: string
	isEmpty: boolean
	readme?: GitStorageRepositoryReadme
	rootEntries: GitStorageRepositoryTreeEntry[]
}

export interface GitStorageRepositoryBranchRef {
	type: 'branch'
	name: string
	qualifiedName: string
	target: string
}

export interface GitStorageRepositoryTagRef {
	type: 'tag'
	name: string
	qualifiedName: string
	signature?: GitStorageRepositorySignature
	target: string
}

export type GitStorageRepositoryRef =
	| GitStorageRepositoryBranchRef
	| GitStorageRepositoryTagRef

export interface GitStorageRepositoryRefs {
	branches: GitStorageRepositoryBranchRef[]
	tags: GitStorageRepositoryTagRef[]
}

export interface GitStorageRepositoryTree {
	commitId: string
	entries: GitStorageRepositoryTreeEntry[]
	path: string
}

export type GitStorageRepositoryBlobPreview =
	| { type: 'text'; content: string }
	| { type: 'binary' }
	| { type: 'tooLarge'; previewLimitBytes: number }

export interface GitStorageRepositoryBlob {
	objectId: string
	preview: GitStorageRepositoryBlobPreview
	sizeBytes: number
}

export interface GitStorageRepositoryRawBlob {
	content: Uint8Array
	objectId: string
	sizeBytes: number
}

export interface GitStorageRepositoryCommitIdentity {
	date: string
	email: string
	name: string
}

export type GitStorageRepositorySignatureState =
	| 'bad'
	| 'expired'
	| 'revoked'
	| 'trusted'
	| 'unknown'
	| 'unsigned'
	| 'untrusted'
	| 'valid'

export interface GitStorageRepositorySignature {
	fingerprint?: string
	keyId?: string
	primaryKeyFingerprint?: string
	signer?: string
	state: GitStorageRepositorySignatureState
}

export interface GitStorageRepositoryCommit {
	author: GitStorageRepositoryCommitIdentity | undefined
	committer: GitStorageRepositoryCommitIdentity | undefined
	sha: string
	shortSha: string
	signature: GitStorageRepositorySignature
	summary: string
}

export interface GitStorageRepositoryCommitHistory {
	commits: GitStorageRepositoryCommit[]
}

export interface GitStorageRepositoryComparisonCommit {
	author: GitStorageRepositoryCommitIdentity | undefined
	sha: string
	shortSha: string
	summary: string
}

export type GitStorageRepositoryChangedFileStatus =
	| 'added'
	| 'deleted'
	| 'modified'
	| 'renamed'

export interface GitStorageRepositoryChangedFile {
	additions: number
	baseBlobId?: string
	deletions: number
	headBlobId?: string
	isBinary: boolean
	newPath: string
	oldPath: string
	status: GitStorageRepositoryChangedFileStatus
}

export interface GitStorageRepositoryComparison {
	baseSha: string
	commitLimit: number
	commits: GitStorageRepositoryComparisonCommit[]
	commitsTruncated: boolean
	fileLimit: number
	files: GitStorageRepositoryChangedFile[]
	headSha: string
	isTruncated: boolean
	mergeBaseSha: string
}

export type GitStorageRepositoryDiffLineKind =
	| 'addition'
	| 'context'
	| 'deletion'

export interface GitStorageRepositoryDiffLine {
	content: string
	kind: GitStorageRepositoryDiffLineKind
	newLine?: number
	oldLine?: number
}

export interface GitStorageRepositoryDiffHunk {
	header: string
	lines: GitStorageRepositoryDiffLine[]
}

export interface GitStorageRepositoryMergeability {
	baseSha: string
	conflictPathLimit: number
	conflictPaths: string[]
	conflictPathsTruncated: boolean
	headSha: string
	mergeable: boolean
	mergeBaseSha: string
}

export interface GitStorageRepositoryFileDiff {
	baseSha: string
	file: GitStorageRepositoryChangedFile
	headSha: string
	hunks: GitStorageRepositoryDiffHunk[]
	isTruncated: boolean
	mergeBaseSha: string
	patchLimitBytes: number
}
