import type { GitHubImportRepository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { GitHubImportLoadingState } from './github-import-loading-state'
import { GitHubImportMessage } from './github-import-message'
import { GitHubImportRepositoryRow } from './github-import-repository-row'
import { GitHubImportSelectedSource } from './github-import-selected-source'

interface GitHubImportSourceSelectorProps {
	error?: unknown
	isError: boolean
	isLoading: boolean
	onSelectRepository: (repositoryId: number) => void
	repositories: GitHubImportRepository[]
	selectedRepositoryId?: number
}

export function GitHubImportSourceSelector({
	error,
	isError,
	isLoading,
	onSelectRepository,
	repositories,
	selectedRepositoryId,
}: Readonly<GitHubImportSourceSelectorProps>) {
	const selectedRepository = repositories.find(
		repository => repository.githubId === selectedRepositoryId
	)

	if (isLoading) return <GitHubImportLoadingState />

	if (isError)
		return (
			<GitHubImportMessage
				description={
					isAuthenticationError(error)
						? 'Reconnect GitHub from your profile, then return here.'
						: 'GitHub repositories could not be loaded.'
				}
				title={
					isAuthenticationError(error)
						? 'GitHub access needs attention'
						: 'Repository list unavailable'
				}
			/>
		)

	if (repositories.length === 0)
		return (
			<GitHubImportMessage
				description="No GitHub repositories are available for import yet."
				title="No repositories found"
			/>
		)

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
			<Card className="gap-0 divide-y divide-border p-0">
				{repositories.map(repository => (
					<GitHubImportRepositoryRow
						isSelected={repository.githubId === selectedRepositoryId}
						key={repository.githubId}
						onSelectRepository={onSelectRepository}
						repository={repository}
					/>
				))}
			</Card>
			<GitHubImportSelectedSource repository={selectedRepository} />
		</div>
	)
}

export function isAuthenticationError(error: unknown) {
	if (!error || typeof error !== 'object' || !('status' in error)) return false

	return error.status === 401 || error.status === 403
}
