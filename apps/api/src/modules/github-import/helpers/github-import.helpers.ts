import type { GitHubRepositoryImport } from '@repo/contracts'
import type { RepositoryImport } from '@repo/db'

const GITHUB_SCOPE_SEPARATOR_REGEX = /[,\s]+/

export function hasGitHubRepoScope(scope: string) {
	return scope
		.split(GITHUB_SCOPE_SEPARATOR_REGEX)
		.some(githubScope => githubScope.trim().toLowerCase() === 'repo')
}

export function toGitHubRepositoryImport({
	completedAt,
	createdAt,
	failureReason,
	id,
	provider,
	repositoryId,
	sourceDefaultBranch,
	sourceFullName,
	sourceGithubId,
	sourceGithubUrl,
	sourceName,
	sourceOwnerLogin,
	sourceVisibility,
	startedAt,
	status,
	targetName,
	targetSlug,
	updatedAt,
}: RepositoryImport): GitHubRepositoryImport {
	return {
		id,
		repositoryId: repositoryId ?? undefined,
		provider,
		targetName,
		targetSlug,
		source: {
			githubId: sourceGithubId.toString(),
			ownerLogin: sourceOwnerLogin,
			name: sourceName,
			fullName: sourceFullName,
			visibility: sourceVisibility,
			defaultBranch: sourceDefaultBranch,
			githubUrl: sourceGithubUrl,
		},
		status,
		failureReason: failureReason ?? undefined,
		startedAt: startedAt ?? undefined,
		completedAt: completedAt ?? undefined,
		createdAt,
		updatedAt,
	}
}
