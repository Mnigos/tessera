import type {
	RepositoryTreeEntry as GeneratedRepositoryTreeEntry,
	GetRepositoryBlobResponse,
	GetRepositoryBrowserSummaryResponse,
	GetRepositoryTreeResponse,
} from './generated/tessera/git/v1/git_storage'
import {
	RepositoryBlobPreviewState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryTree,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client'

const textDecoder = new TextDecoder()

type RuntimeRepositoryBrowserSummaryResponse =
	Partial<GetRepositoryBrowserSummaryResponse> & {
		readme?: Partial<NonNullable<GetRepositoryBrowserSummaryResponse['readme']>>
	}
type RuntimeRepositoryTreeResponse = Partial<GetRepositoryTreeResponse>
type RuntimeRepositoryBlobResponse = Partial<GetRepositoryBlobResponse>
type RuntimeRepositoryTreeEntry = Partial<GeneratedRepositoryTreeEntry>

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

function toUint64Number(value: number | string | undefined) {
	return Number(value ?? 0)
}
