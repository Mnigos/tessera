import type { GetRepositoryBrowserSummaryResponse } from './generated/tessera/git/v1/git_storage'
import { RepositoryTreeEntryKind } from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client'

const textDecoder = new TextDecoder()

type RuntimeRepositoryBrowserSummaryResponse =
	Partial<GetRepositoryBrowserSummaryResponse> & {
		readme?: Partial<NonNullable<GetRepositoryBrowserSummaryResponse['readme']>>
	}

/** Maps the generated gRPC browser summary into the API-facing storage client shape. */
export function toRepositoryBrowserSummary({
	defaultBranch,
	isEmpty,
	readme,
	rootEntries,
}: RuntimeRepositoryBrowserSummaryResponse): GitStorageRepositoryBrowserSummary {
	return {
		defaultBranch: defaultBranch ?? '',
		isEmpty: isEmpty ?? false,
		rootEntries: (rootEntries ?? []).map(entry => ({
			name: entry.name,
			objectId: entry.objectId,
			kind: toRepositoryTreeEntryKind(entry.kind),
			sizeBytes: Number(entry.sizeBytes ?? 0),
			path: entry.path,
			mode: entry.mode,
		})),
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

function toRepositoryTreeEntryKind(
	kind: RepositoryTreeEntryKind
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
