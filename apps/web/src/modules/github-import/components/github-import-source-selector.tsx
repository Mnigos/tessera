import type { GitHubImportRepository } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { FaGithub } from 'react-icons/fa'
import { GitHubImportLoadingState } from './github-import-loading-state'
import { GitHubImportMessage } from './github-import-message'
import { GitHubImportRepositoryRow } from './github-import-repository-row'
import { GitHubImportSelectedSource } from './github-import-selected-source'

interface GitHubImportSourceSelectorProps {
	error?: unknown
	importError?: unknown
	isError: boolean
	isImporting: boolean
	isLoading: boolean
	onReconnectGitHub?: () => void
	onContinue: () => void
	onSelectAllRepositories: () => void
	onToggleRepository: (repositoryId: string) => void
	repositories: GitHubImportRepository[]
	selectedRepositoryIds: string[]
}

export function GitHubImportSourceSelector({
	error,
	importError,
	isError,
	isImporting,
	isLoading,
	onContinue,
	onReconnectGitHub,
	onSelectAllRepositories,
	onToggleRepository,
	repositories,
	selectedRepositoryIds,
}: Readonly<GitHubImportSourceSelectorProps>) {
	const selectedRepositoryIdSet = new Set(selectedRepositoryIds)
	const selectedRepositories = repositories.filter(repository =>
		selectedRepositoryIdSet.has(repository.githubId)
	)
	const areAllRepositoriesSelected =
		repositories.length > 0 &&
		selectedRepositories.length === repositories.length
	const needsGitHubReconnect = isGitHubAccessError(error)

	if (isLoading) return <GitHubImportLoadingState />

	if (isError)
		return (
			<GitHubImportMessage
				action={
					needsGitHubReconnect && onReconnectGitHub ? (
						<Button onClick={onReconnectGitHub} size="sm">
							<FaGithub className="size-4" />
							Reconnect GitHub
						</Button>
					) : undefined
				}
				description={
					needsGitHubReconnect
						? 'Reconnect GitHub with repository access, then return here.'
						: 'GitHub repositories could not be loaded.'
				}
				title={
					needsGitHubReconnect
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
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm">
						{selectedRepositories.length} selected
					</p>
					<Button
						className="cursor-pointer transition duration-150 ease-out hover:-translate-y-px"
						onClick={onSelectAllRepositories}
						size="sm"
						variant="secondary"
					>
						{areAllRepositoriesSelected ? 'Clear all' : 'Select all'}
					</Button>
				</div>
				<Card className="gap-0 divide-y divide-border p-0">
					{repositories.map(repository => (
						<GitHubImportRepositoryRow
							isSelected={selectedRepositoryIdSet.has(repository.githubId)}
							key={repository.githubId}
							onToggleRepository={onToggleRepository}
							repository={repository}
						/>
					))}
				</Card>
			</div>
			<GitHubImportSelectedSource
				error={importError}
				isImporting={isImporting}
				onContinue={onContinue}
				repositories={selectedRepositories}
			/>
		</div>
	)
}

export function isGitHubAccessError(error: unknown) {
	if (!error || typeof error !== 'object') return false
	if ('code' in error && error.code === 'UNAUTHORIZED') return true
	if ('code' in error && error.code === 'FORBIDDEN') return true
	if (
		'message' in error &&
		error.message === 'github import authentication required'
	)
		return true
	if ('message' in error && error.message === 'github import access denied')
		return true

	return 'status' in error && (error.status === 401 || error.status === 403)
}
