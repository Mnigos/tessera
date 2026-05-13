import type { GetRepositoryBrowserSummaryResponse } from './generated/tessera/git/v1/git_storage'
import { RepositoryTreeEntryKind } from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client'

const textDecoder = new TextDecoder()

/** Maps the generated gRPC browser summary into the API-facing storage client shape. */
export function toRepositoryBrowserSummary({
	defaultBranch,
	isEmpty,
	readme,
	rootEntries,
}: GetRepositoryBrowserSummaryResponse): GitStorageRepositoryBrowserSummary {
	return {
		defaultBranch,
		isEmpty,
		rootEntries: rootEntries.map(entry => ({
			name: entry.name,
			objectId: entry.objectId,
			kind: toRepositoryTreeEntryKind(entry.kind),
			sizeBytes: entry.sizeBytes,
			path: entry.path,
			mode: entry.mode,
		})),
		readme: readme
			? {
					filename: readme.filename,
					objectId: readme.objectId,
					content: textDecoder.decode(readme.content),
					isTruncated: readme.isTruncated,
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
