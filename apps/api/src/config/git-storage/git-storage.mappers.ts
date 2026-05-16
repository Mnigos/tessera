import type {
	RepositoryCommit as GeneratedRepositoryCommit,
	RepositoryCommitIdentity as GeneratedRepositoryCommitIdentity,
	RepositoryRef as GeneratedRepositoryRef,
	RepositoryTreeEntry as GeneratedRepositoryTreeEntry,
	GetRepositoryBlobResponse,
	GetRepositoryBrowserSummaryResponse,
	GetRepositoryRawBlobResponse,
	GetRepositoryTreeResponse,
	ListRepositoryCommitsResponse,
	ListRepositoryRefsResponse,
} from './generated/tessera/git/v1/git_storage'
import {
	RepositoryBlobPreviewState,
	RepositoryRefKind,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryCommit,
	GitStorageRepositoryCommitHistory,
	GitStorageRepositoryCommitIdentity,
	GitStorageRepositoryRawBlob,
	GitStorageRepositoryRefs,
	GitStorageRepositoryTree,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client'

const textDecoder = new TextDecoder()

interface RuntimeRepositoryBrowserSummaryResponse
	extends Omit<Partial<GetRepositoryBrowserSummaryResponse>, 'rootEntries'> {
	rootEntries?: RuntimeRepositoryTreeEntry[]
}

interface RuntimeRepositoryTreeResponse
	extends Omit<Partial<GetRepositoryTreeResponse>, 'entries'> {
	entries?: RuntimeRepositoryTreeEntry[]
}

type RuntimeRepositoryBlobResponse = Partial<GetRepositoryBlobResponse>

type RuntimeRepositoryRawBlobResponse = Partial<GetRepositoryRawBlobResponse>

interface RuntimeRepositoryCommitHistoryResponse
	extends Omit<Partial<ListRepositoryCommitsResponse>, 'commits'> {
	commits?: RuntimeRepositoryCommit[]
}

interface RuntimeRepositoryRefsResponse
	extends Omit<Partial<ListRepositoryRefsResponse>, 'refs'> {
	refs?: RuntimeRepositoryRef[]
}

type RuntimeRepositoryTreeEntry = Partial<GeneratedRepositoryTreeEntry>

type RuntimeRepositoryCommit = Partial<GeneratedRepositoryCommit>

type RuntimeRepositoryCommitIdentity =
	Partial<GeneratedRepositoryCommitIdentity>

type RuntimeRepositoryRef = Partial<GeneratedRepositoryRef>

/**
 * Converts a browser summary gRPC payload into the repository browser model exposed by the API.
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
 * Converts a tree gRPC payload into the API tree model while normalizing missing entry fields.
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
 * Converts a blob preview gRPC payload into the API blob model and preview union.
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
 * Converts a raw blob gRPC payload into the API raw blob byte model.
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
 * Converts a commit list gRPC payload into the API commit history model.
 */
export function toRepositoryCommitHistory({
	commits,
}: RuntimeRepositoryCommitHistoryResponse): GitStorageRepositoryCommitHistory {
	return {
		commits: (commits ?? []).map(toRepositoryCommit),
	}
}

/**
 * Groups branch and tag gRPC refs into API ref lists with display names, qualified names, and targets.
 */
export function toRepositoryRefs({
	refs,
}: RuntimeRepositoryRefsResponse): GitStorageRepositoryRefs {
	const repositoryRefs = refs ?? []

	return {
		branches: repositoryRefs
			.filter(ref => ref.kind === RepositoryRefKind.REPOSITORY_REF_KIND_BRANCH)
			.map(ref => toRepositoryRef('branch', ref)),
		tags: repositoryRefs
			.filter(ref => ref.kind === RepositoryRefKind.REPOSITORY_REF_KIND_TAG)
			.map(ref => toRepositoryRef('tag', ref)),
	}
}

/**
 * Normalizes a single tree entry from the generated gRPC shape into the API tree entry shape.
 */
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

/**
 * Normalizes a branch ref from the generated gRPC shape into the API branch ref shape.
 */
function toRepositoryRef(
	type: 'branch',
	{ commitId, displayName, qualifiedName }: RuntimeRepositoryRef
): GitStorageRepositoryRefs['branches'][number]
/**
 * Normalizes a tag ref from the generated gRPC shape into the API tag ref shape.
 */
function toRepositoryRef(
	type: 'tag',
	{ commitId, displayName, qualifiedName }: RuntimeRepositoryRef
): GitStorageRepositoryRefs['tags'][number]
/**
 * Normalizes a repository ref from the generated gRPC shape into the matching API ref shape.
 */
function toRepositoryRef(
	type: 'branch' | 'tag',
	{ commitId, displayName, qualifiedName }: RuntimeRepositoryRef
):
	| GitStorageRepositoryRefs['branches'][number]
	| GitStorageRepositoryRefs['tags'][number] {
	return {
		type,
		name: displayName ?? '',
		qualifiedName: qualifiedName ?? '',
		target: commitId ?? '',
	}
}

/**
 * Normalizes a single commit from the generated gRPC shape into the API commit shape.
 */
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

/**
 * Normalizes optional commit identity metadata, preserving absence when Git omits it.
 */
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

/**
 * Converts the generated blob preview enum fields into the API preview union.
 */
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

/**
 * Converts generated tree entry kind enums into the API tree entry kind union.
 */
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

/**
 * Converts optional generated uint64 numeric fields to API numbers with a zero fallback.
 */
function toUint64Number(value: number | undefined) {
	return Number(value ?? 0)
}
