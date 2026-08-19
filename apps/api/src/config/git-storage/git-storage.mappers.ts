import type {
	MergeStrategy,
	MergeStrategyUnavailableReason,
} from '@repo/domain'
import { mergeStrategies } from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import type {
	CheckRepositoryMergeabilityResponse,
	CompareRepositoryRefsResponse,
	RepositoryChangedFile as GeneratedRepositoryChangedFile,
	RepositoryCommit as GeneratedRepositoryCommit,
	RepositoryCommitIdentity as GeneratedRepositoryCommitIdentity,
	RepositoryComparisonCommit as GeneratedRepositoryComparisonCommit,
	RepositoryDiffHunk as GeneratedRepositoryDiffHunk,
	RepositoryDiffLine as GeneratedRepositoryDiffLine,
	RepositoryMergeStrategyAvailability as GeneratedRepositoryMergeStrategyAvailability,
	RepositoryRef as GeneratedRepositoryRef,
	RepositorySignature as GeneratedRepositorySignature,
	RepositoryTreeEntry as GeneratedRepositoryTreeEntry,
	GetRepositoryBlobResponse,
	GetRepositoryBrowserSummaryResponse,
	GetRepositoryFileDiffResponse,
	GetRepositoryRawBlobResponse,
	GetRepositoryTreeResponse,
	ListRepositoryCommitsResponse,
	ListRepositoryRefsResponse,
} from './generated/tessera/git/v1/git_storage'
import {
	RepositoryBlobPreviewState,
	RepositoryChangedFileStatus,
	RepositoryDiffLineKind,
	RepositoryMergeStrategy,
	RepositoryMergeStrategyUnavailableReason,
	RepositoryRefKind,
	RepositorySignatureState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import type {
	GitStorageRepositoryBlob,
	GitStorageRepositoryBrowserSummary,
	GitStorageRepositoryChangedFile,
	GitStorageRepositoryCommit,
	GitStorageRepositoryCommitHistory,
	GitStorageRepositoryCommitIdentity,
	GitStorageRepositoryComparison,
	GitStorageRepositoryComparisonCommit,
	GitStorageRepositoryDiffHunk,
	GitStorageRepositoryDiffLine,
	GitStorageRepositoryFileDiff,
	GitStorageRepositoryMergeability,
	GitStorageRepositoryMergeStrategyAvailability,
	GitStorageRepositoryRawBlob,
	GitStorageRepositoryRefs,
	GitStorageRepositorySignature,
	GitStorageRepositoryTree,
	GitStorageRepositoryTreeEntry,
} from './git-storage.client.types'

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

type RuntimeRepositoryMergeabilityResponse = Omit<
	Partial<CheckRepositoryMergeabilityResponse>,
	'strategyAvailability'
> & { strategyAvailability?: RuntimeRepositoryMergeStrategyAvailability[] }

type RuntimeRepositoryMergeStrategyAvailability =
	Partial<GeneratedRepositoryMergeStrategyAvailability>

/**
 * The one place the wire enums are turned into Tessera's own names. Both
 * directions are total maps rather than switches: an unrecognised value is data
 * from a newer git storage, and the reader decides what to do with it.
 */
const MERGE_STRATEGIES_BY_PROTO = new Map<number, MergeStrategy>([
	[
		RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_MERGE_COMMIT,
		'merge_commit',
	],
	[RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_SQUASH, 'squash'],
	[RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_REBASE, 'rebase'],
	[
		RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_FAST_FORWARD,
		'fast_forward',
	],
])

const PROTO_BY_MERGE_STRATEGY = new Map<MergeStrategy, RepositoryMergeStrategy>(
	[...MERGE_STRATEGIES_BY_PROTO].map(([proto, strategy]) => [strategy, proto])
)

const UNAVAILABLE_REASONS_BY_PROTO = new Map<
	number,
	MergeStrategyUnavailableReason
>([
	[
		RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_CONFLICT,
		'conflict',
	],
	[
		RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_NOT_FAST_FORWARD,
		'not_fast_forward',
	],
	[
		RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_ALREADY_UP_TO_DATE,
		'already_up_to_date',
	],
	[
		RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_NOTHING_TO_REBASE,
		'nothing_to_rebase',
	],
	[
		RepositoryMergeStrategyUnavailableReason.REPOSITORY_MERGE_STRATEGY_UNAVAILABLE_REASON_UNSUPPORTED_HISTORY,
		'unsupported_history',
	],
])

/** The wire value for a strategy this build knows how to ask for. */
export function toProtoMergeStrategy(
	strategy: MergeStrategy
): RepositoryMergeStrategy {
	return (
		PROTO_BY_MERGE_STRATEGY.get(strategy) ??
		RepositoryMergeStrategy.REPOSITORY_MERGE_STRATEGY_UNSPECIFIED
	)
}

interface RuntimeRepositoryComparisonResponse
	extends Omit<Partial<CompareRepositoryRefsResponse>, 'commits' | 'files'> {
	commits?: RuntimeRepositoryComparisonCommit[]
	files?: RuntimeRepositoryChangedFile[]
}

interface RuntimeRepositoryFileDiffResponse
	extends Omit<Partial<GetRepositoryFileDiffResponse>, 'file' | 'hunks'> {
	file?: RuntimeRepositoryChangedFile
	hunks?: RuntimeRepositoryDiffHunk[]
}

interface RuntimeRepositoryCommitHistoryResponse
	extends Omit<Partial<ListRepositoryCommitsResponse>, 'commits'> {
	commits?: RuntimeRepositoryCommit[]
}

interface RuntimeRepositoryRefsResponse
	extends Omit<Partial<ListRepositoryRefsResponse>, 'refs'> {
	refs?: RuntimeRepositoryRef[]
}

type RuntimeRepositoryTreeEntry = Partial<GeneratedRepositoryTreeEntry>

type RuntimeRepositoryCommitIdentity =
	Partial<GeneratedRepositoryCommitIdentity>

interface RuntimeRepositoryCommitSignature
	extends Partial<GeneratedRepositorySignature> {}

interface RuntimeRepositoryCommit
	extends Omit<Partial<GeneratedRepositoryCommit>, 'signature'> {
	signature?: RuntimeRepositoryCommitSignature
}

interface RuntimeRepositoryRef
	extends Omit<Partial<GeneratedRepositoryRef>, 'signature'> {
	signature?: RuntimeRepositoryCommitSignature
}

interface RuntimeRepositoryComparisonCommit
	extends Omit<Partial<GeneratedRepositoryComparisonCommit>, 'author'> {
	author?: RuntimeRepositoryCommitIdentity
}

type RuntimeRepositoryChangedFile = Partial<GeneratedRepositoryChangedFile>

interface RuntimeRepositoryDiffHunk
	extends Omit<Partial<GeneratedRepositoryDiffHunk>, 'lines'> {
	lines?: RuntimeRepositoryDiffLine[]
}

type RuntimeRepositoryDiffLine = Partial<GeneratedRepositoryDiffLine>

/**
 * Converts a browser summary gRPC payload into the repository browser model exposed by the API.
 */
export function toRepositoryBrowserSummary({
	commitCount,
	defaultBranch,
	isEmpty,
	readme,
	rootEntries,
}: RuntimeRepositoryBrowserSummaryResponse): GitStorageRepositoryBrowserSummary {
	return {
		commitCount: toUint64Number(commitCount),
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
 * Converts a read-only mergeability gRPC payload into the API mergeability model.
 */
export function toRepositoryMergeability({
	baseSha,
	conflictPathLimit,
	conflictPaths,
	conflictPathsTruncated,
	headSha,
	mergeable,
	mergeBaseSha,
	strategyAvailability,
}: RuntimeRepositoryMergeabilityResponse): GitStorageRepositoryMergeability {
	return {
		baseSha: baseSha ?? '',
		headSha: headSha ?? '',
		mergeBaseSha: mergeBaseSha ?? '',
		mergeable: mergeable ?? false,
		strategyAvailability: toStrategyAvailability(strategyAvailability),
		conflictPaths: conflictPaths ?? [],
		conflictPathsTruncated: conflictPathsTruncated ?? false,
		conflictPathLimit: conflictPathLimit ?? 0,
	}
}

/**
 * Converts a branch comparison gRPC payload into the API comparison model.
 */
export function toRepositoryComparison({
	baseSha,
	commitLimit,
	commits,
	commitsTruncated,
	fileLimit,
	files,
	headSha,
	isTruncated,
	mergeBaseSha,
}: RuntimeRepositoryComparisonResponse): GitStorageRepositoryComparison {
	return {
		baseSha: baseSha ?? '',
		commitLimit: commitLimit ?? 0,
		headSha: headSha ?? '',
		mergeBaseSha: mergeBaseSha ?? '',
		commits: (commits ?? []).map(toRepositoryComparisonCommit),
		commitsTruncated: commitsTruncated ?? false,
		files: (files ?? []).map(toRepositoryChangedFile),
		isTruncated: isTruncated ?? false,
		fileLimit: fileLimit ?? 0,
	}
}

/**
 * Converts a lazy file diff gRPC payload into structured diff hunks.
 */
export function toRepositoryFileDiff({
	baseSha,
	file,
	headSha,
	hunks,
	isTruncated,
	mergeBaseSha,
	patchLimitBytes,
}: RuntimeRepositoryFileDiffResponse): GitStorageRepositoryFileDiff {
	if (!file)
		throw new ExternalServiceError('git storage', {
			reason: 'missing_file_diff_entry',
		})

	return {
		baseSha: baseSha ?? '',
		headSha: headSha ?? '',
		mergeBaseSha: mergeBaseSha ?? '',
		file: toRepositoryChangedFile(file),
		hunks: (hunks ?? []).map(toRepositoryDiffHunk),
		isTruncated: isTruncated ?? false,
		patchLimitBytes: toUint64Number(patchLimitBytes),
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
	{ commitId, displayName, qualifiedName, signature }: RuntimeRepositoryRef
): GitStorageRepositoryRefs['tags'][number]
/**
 * Normalizes a repository ref from the generated gRPC shape into the matching API ref shape.
 */
function toRepositoryRef(
	type: 'branch' | 'tag',
	{ commitId, displayName, qualifiedName, signature }: RuntimeRepositoryRef
):
	| GitStorageRepositoryRefs['branches'][number]
	| GitStorageRepositoryRefs['tags'][number] {
	const repositoryRef = {
		type,
		name: displayName ?? '',
		qualifiedName: qualifiedName ?? '',
		target: commitId ?? '',
	}

	if (type === 'branch') return repositoryRef

	return {
		...repositoryRef,
		signature: signature ? toRepositorySignature(signature) : undefined,
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
	signature,
	summary,
}: RuntimeRepositoryCommit): GitStorageRepositoryCommit {
	return {
		sha: sha ?? '',
		shortSha: shortSha ?? '',
		summary: summary ?? '',
		author: toRepositoryCommitIdentity(author),
		committer: toRepositoryCommitIdentity(committer),
		signature: toRepositorySignature(signature),
	}
}

function toRepositoryComparisonCommit({
	author,
	sha,
	shortSha,
	summary,
}: RuntimeRepositoryComparisonCommit): GitStorageRepositoryComparisonCommit {
	return {
		author: toRepositoryCommitIdentity(author),
		sha: sha ?? '',
		shortSha: shortSha ?? '',
		summary: summary ?? '',
	}
}

function toRepositoryChangedFile({
	additions,
	baseBlobId,
	deletions,
	headBlobId,
	isBinary,
	newPath,
	oldPath,
	status,
}: RuntimeRepositoryChangedFile): GitStorageRepositoryChangedFile {
	return {
		additions: additions ?? 0,
		baseBlobId: baseBlobId || undefined,
		deletions: deletions ?? 0,
		headBlobId: headBlobId || undefined,
		isBinary: isBinary ?? false,
		newPath: newPath ?? '',
		oldPath: oldPath ?? '',
		status: toRepositoryChangedFileStatus(status),
	}
}

function toRepositoryChangedFileStatus(
	status: RepositoryChangedFileStatus | undefined
): GitStorageRepositoryChangedFile['status'] {
	switch (status) {
		case RepositoryChangedFileStatus.REPOSITORY_CHANGED_FILE_STATUS_ADDED:
			return 'added'
		case RepositoryChangedFileStatus.REPOSITORY_CHANGED_FILE_STATUS_DELETED:
			return 'deleted'
		case RepositoryChangedFileStatus.REPOSITORY_CHANGED_FILE_STATUS_RENAMED:
			return 'renamed'
		default:
			return 'modified'
	}
}

function toRepositoryDiffHunk({
	header,
	lines,
}: RuntimeRepositoryDiffHunk): GitStorageRepositoryDiffHunk {
	return {
		header: header ?? '',
		lines: (lines ?? []).map(toRepositoryDiffLine),
	}
}

function toRepositoryDiffLine({
	content,
	kind,
	newLine,
	oldLine,
}: RuntimeRepositoryDiffLine): GitStorageRepositoryDiffLine {
	return {
		content: content ?? '',
		kind: toRepositoryDiffLineKind(kind),
		newLine,
		oldLine,
	}
}

function toRepositoryDiffLineKind(
	kind: RepositoryDiffLineKind | undefined
): GitStorageRepositoryDiffLine['kind'] {
	if (kind === RepositoryDiffLineKind.REPOSITORY_DIFF_LINE_KIND_ADDITION)
		return 'addition'
	if (kind === RepositoryDiffLineKind.REPOSITORY_DIFF_LINE_KIND_DELETION)
		return 'deletion'

	return 'context'
}

function toRepositorySignature(
	signature: RuntimeRepositoryCommitSignature | undefined
): GitStorageRepositorySignature {
	if (!signature)
		return {
			state: 'unsigned',
		}

	return {
		state: toRepositorySignatureState(signature.state),
		keyId: signature.keyId || undefined,
		fingerprint: signature.fingerprint || undefined,
		primaryKeyFingerprint: signature.primaryKeyFingerprint || undefined,
		signer: signature.signer || undefined,
	}
}

/**
 * Every strategy's answer, or nothing at all.
 *
 * A git storage that answers for strategies answers for all four of them, so a
 * set that is missing any of them did not come from one that does. That is the
 * only way to tell a legacy response apart from a modern one: protobuf decodes
 * an omitted repeated field to an empty list, which is indistinguishable from a
 * genuinely empty answer. Reporting nothing here is what lets every caller
 * refuse to merge rather than assume a method is available.
 */
function toStrategyAvailability(
	strategyAvailability: RuntimeRepositoryMergeStrategyAvailability[] | undefined
): GitStorageRepositoryMergeStrategyAvailability[] | undefined {
	const entries = (strategyAvailability ?? []).flatMap(
		toRepositoryMergeStrategyAvailability
	)
	const answered = new Set(entries.map(entry => entry.strategy))

	return mergeStrategies.every(strategy => answered.has(strategy))
		? entries
		: undefined
}

/**
 * One strategy's answer. An entry naming a strategy this build does not know is
 * dropped rather than guessed at: a merge method nobody here can execute has no
 * business being offered, and inventing a name for it would put it in the UI.
 */
function toRepositoryMergeStrategyAvailability({
	available,
	reason,
	strategy,
}: RuntimeRepositoryMergeStrategyAvailability): GitStorageRepositoryMergeStrategyAvailability[] {
	const mergeStrategy = MERGE_STRATEGIES_BY_PROTO.get(strategy ?? -1)

	if (!mergeStrategy) return []

	return [
		{
			strategy: mergeStrategy,
			available: available ?? false,
			reason: available
				? undefined
				: UNAVAILABLE_REASONS_BY_PROTO.get(reason ?? -1),
		},
	]
}

function toRepositorySignatureState(
	state: RepositorySignatureState | undefined
): GitStorageRepositorySignature['state'] {
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_VALID)
		return 'valid'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_TRUSTED)
		return 'trusted'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_UNTRUSTED)
		return 'untrusted'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_BAD)
		return 'bad'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_UNKNOWN)
		return 'unknown'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_EXPIRED)
		return 'expired'
	if (state === RepositorySignatureState.REPOSITORY_SIGNATURE_STATE_REVOKED)
		return 'revoked'

	return 'unsigned'
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
