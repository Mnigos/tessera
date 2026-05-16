import type {
	RepositoryCommit as GeneratedRepositoryCommit,
	RepositoryCommitIdentity as GeneratedRepositoryCommitIdentity,
	RepositoryTreeEntry as GeneratedRepositoryTreeEntry,
	GetRepositoryBlobResponse,
	GetRepositoryBrowserSummaryResponse,
	GetRepositoryRawBlobResponse,
	GetRepositoryTreeResponse,
	ListRepositoryCommitsResponse,
} from './generated/tessera/git/v1/git_storage'
import {
	RepositoryBlobPreviewState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryCommit,
	GitStorageRepositoryCommitHistory,
	GitStorageRepositoryCommitIdentity,
	GitStorageRepositoryRawBlob,
	GitStorageRepositoryTree,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client'

const textDecoder = new TextDecoder()

type RuntimeRepositoryBrowserSummaryResponse = Omit<
	Partial<GetRepositoryBrowserSummaryResponse>,
	'rootEntries'
> & {
	rootEntries?: RuntimeRepositoryTreeEntry[]
}

type RuntimeRepositoryTreeResponse = Omit<
	Partial<GetRepositoryTreeResponse>,
	'entries'
> & {
	entries?: RuntimeRepositoryTreeEntry[]
}

type RuntimeRepositoryBlobResponse = Partial<GetRepositoryBlobResponse>

type RuntimeRepositoryRawBlobResponse = Partial<GetRepositoryRawBlobResponse>

type RuntimeRepositoryCommitHistoryResponse = Omit<
	Partial<ListRepositoryCommitsResponse>,
	'commits'
> & {
	commits?: RuntimeRepositoryCommit[]
}

type RuntimeRepositoryTreeEntry = Partial<GeneratedRepositoryTreeEntry>

type RuntimeRepositoryCommit = Partial<GeneratedRepositoryCommit>

type RuntimeRepositoryCommitIdentity =
	Partial<GeneratedRepositoryCommitIdentity>

/**
 * Maps the git storage browser summary response into the API-facing repository browser model.
 */
export function toRepositoryBrowserSummary({
	defaultBranch,
	isEmpty,
	readme,
	rootEntries,
}: RuntimeRepositoryBrowserSummaryResponse): GitStorageRepositoryBrowserSummary {
	return {
		defaultBranch: defaultBranch ?? '',
		isEmpty: isEmpty ?? false,
		rootEntries: (rootEntries ?? []).map(toRepositoryTreeEntry),
		readme: readme
			? {
					filename: readme.filename ?? '',
					objectId: readme.objectId ?? '',
					content: textDecoder.decode(readme.content ?? new Uint8Array()),
					isTruncated: readme.isTruncated ?? false,
				}
			: undefined,
	}
}

/**
 * Maps the git storage tree response into the API-facing repository tree model.
 */
export function toRepositoryTree({
	commitId,
	entries,
	path,
}: RuntimeRepositoryTreeResponse): GitStorageRepositoryTree {
	return {
		commitId: commitId ?? '',
		path: path ?? '',
		entries: (entries ?? []).map(toRepositoryTreeEntry),
	}
}

/**
 * Maps the git storage blob preview response into the API-facing repository blob model.
 */
export function toRepositoryBlob({
	objectId,
	previewLimitBytes,
	sizeBytes,
	state,
	text,
}: RuntimeRepositoryBlobResponse): GitStorageRepositoryBlob {
	return {
		objectId: objectId ?? '',
		sizeBytes: toUint64Number(sizeBytes),
		preview: toRepositoryBlobPreview({
			previewLimitBytes,
			state,
			text,
		}),
	}
}

/**
 * Maps the git storage raw blob response into the API-facing raw blob byte model.
 */
export function toRepositoryRawBlob({
	content,
	objectId,
	sizeBytes,
}: RuntimeRepositoryRawBlobResponse): GitStorageRepositoryRawBlob {
	return {
		objectId: objectId ?? '',
		content: content ?? new Uint8Array(),
		sizeBytes: toUint64Number(sizeBytes),
	}
}

/**
 * Maps the git storage commit list response into the API-facing repository commit history model.
 */
export function toRepositoryCommitHistory({
	commits,
}: RuntimeRepositoryCommitHistoryResponse): GitStorageRepositoryCommitHistory {
	return {
		commits: (commits ?? []).map(toRepositoryCommit),
	}
}

function toRepositoryTreeEntry(
	entry: RuntimeRepositoryTreeEntry
): GitStorageRepositoryTreeEntry {
	return {
		name: entry.name ?? '',
		objectId: entry.objectId ?? '',
		kind: toRepositoryTreeEntryKind(entry.kind),
		sizeBytes: toUint64Number(entry.sizeBytes),
		path: entry.path ?? '',
		mode: entry.mode ?? '',
	}
}

function toRepositoryCommit({
	author,
	committer,
	sha,
	shortSha,
	summary,
}: RuntimeRepositoryCommit): GitStorageRepositoryCommit {
	return {
		sha: sha ?? '',
		shortSha: shortSha ?? '',
		summary: summary ?? '',
		author: toRepositoryCommitIdentity(author),
		committer: toRepositoryCommitIdentity(committer),
	}
}

function toRepositoryCommitIdentity(
	identity: RuntimeRepositoryCommitIdentity | undefined
): GitStorageRepositoryCommitIdentity | undefined {
	if (!identity) return undefined

	return {
		name: identity.name ?? '',
		email: identity.email ?? '',
		date: identity.date ?? '',
	}
}

function toRepositoryBlobPreview({
	previewLimitBytes,
	state,
	text,
}: Pick<
	RuntimeRepositoryBlobResponse,
	'previewLimitBytes' | 'state' | 'text'
>) {
	if (state === RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TEXT)
		return {
			type: 'text' as const,
			content: text ?? '',
		}

	if (state === RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_BINARY)
		return { type: 'binary' as const }

	if (
		state === RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TOO_LARGE
	)
		return {
			type: 'tooLarge' as const,
			previewLimitBytes: toUint64Number(previewLimitBytes),
		}

	return { type: 'binary' as const }
}

function toRepositoryTreeEntryKind(
	kind: RepositoryTreeEntryKind | undefined
): GitStorageRepositoryTreeEntry['kind'] {
	if (kind === RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE)
		return 'file'
	if (kind === RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_DIRECTORY)
		return 'directory'
	if (kind === RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_SYMLINK)
		return 'symlink'
	if (kind === RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_SUBMODULE)
		return 'submodule'

	return 'unknown'
}

function toUint64Number(value: number | undefined) {
	return Number(value ?? 0)
}
