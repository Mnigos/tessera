import type {
	RepositoryBrowserSummary,
	RepositoryRef,
	RepositoryRefs,
} from '@repo/contracts'

export interface RepositoryRefOption {
	kind: 'branch' | 'tag'
	name: string
	qualifiedName: string
}

/**
 * Builds selector options from discovered refs, falling back to the repository default branch.
 */
export function getRepositoryRefOptions(
	summary: RepositoryBrowserSummary
): RepositoryRefOption[] {
	const branchRefs =
		summary.branches.length > 0
			? summary.branches
			: [getFallbackBranchRef(summary.defaultBranch)].filter(
					(ref): ref is RepositoryRef => Boolean(ref.name)
				)

	return [
		...branchRefs.map(ref => getRepositoryRefOption(ref)),
		...summary.tags.map(ref => getRepositoryRefOption(ref)),
	]
}

export function getRepositoryRefOptionsFromRefs({
	branches,
	tags,
}: RepositoryRefs): RepositoryRefOption[] {
	return [
		...branches.map(ref => getRepositoryRefOption(ref)),
		...tags.map(ref => getRepositoryRefOption(ref)),
	]
}

/**
 * Returns the qualified branch ref used when a repository only has default-branch metadata.
 */
export function getDefaultQualifiedRef(defaultBranch: string) {
	return getRepositoryBranchOption(defaultBranch).qualifiedName
}

/**
 * Builds a branch selector option, preserving already-qualified ref names.
 */
export function getRepositoryBranchOption(name: string): RepositoryRefOption {
	return {
		kind: 'branch',
		name,
		qualifiedName: qualifyRepositoryRef('branch', name),
	}
}

/**
 * Chooses the qualified ref for repository overview links and tree browsing.
 */
export function getSelectedRepositoryQualifiedRef({
	defaultBranch,
	selectedRef,
	summary,
}: {
	defaultBranch: string
	selectedRef?: string
	summary: RepositoryBrowserSummary
}) {
	return (
		summary.selectedRef?.qualifiedName ??
		selectedRef ??
		getDefaultQualifiedRef(defaultBranch)
	)
}

/**
 * Converts an API repository ref into the local selector option shape.
 */
function getRepositoryRefOption(ref: RepositoryRef): RepositoryRefOption {
	return {
		kind: ref.type,
		name: ref.name,
		qualifiedName: ref.qualifiedName,
	}
}

/**
 * Creates a synthetic branch ref when only default-branch metadata is available.
 */
function getFallbackBranchRef(name: string): RepositoryRef {
	return {
		type: 'branch',
		name,
		qualifiedName: getDefaultQualifiedRef(name),
		target: '',
	}
}

export function getFallbackRefOptions(refName: string): RepositoryRefOption[] {
	return [
		{
			kind: 'branch',
			name: getRepositoryRefDisplayName(refName),
			qualifiedName: refName,
		},
	]
}

/**
 * Removes standard Git branch and tag prefixes for compact display.
 */
export function getRepositoryRefDisplayName(refName: string) {
	if (refName.startsWith('refs/heads/'))
		return refName.slice('refs/heads/'.length)
	if (refName.startsWith('refs/tags/'))
		return refName.slice('refs/tags/'.length)

	return refName
}

/**
 * Qualifies an unqualified branch or tag name for browser routes.
 */
function qualifyRepositoryRef(kind: RepositoryRefOption['kind'], name: string) {
	if (name.startsWith('refs/')) return name

	if (kind === 'branch') return `refs/heads/${name}`

	return `refs/tags/${name}`
}
