import {
	GITHUB_IMPORT_SEARCH_MAX_LENGTH,
	type GitHubImportRepository,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { FaGithub } from 'react-icons/fa'
import { SearchInput } from '@/shared/components/search-input'
import { isGitHubAccessError } from '../helpers/is-github-access-error'
import { GitHubImportLoadStatus } from './github-import-load-status'
import { GitHubImportLoadingState } from './github-import-loading-state'
import { GitHubImportMessage } from './github-import-message'
import { GitHubImportRepositoryRow } from './github-import-repository-row'
import { GitHubImportSelectedSource } from './github-import-selected-source'

interface GitHubImportSourceSelectorProps {
	error?: unknown
	hasNextPage: boolean
	importError?: unknown
	isError: boolean
	isFetchingNextPage: boolean
	isFetchNextPageError: boolean
	isImporting: boolean
	isLoading: boolean
	isSearching: boolean
	onContinue: () => void
	onLoadMore: () => void
	onQueryChange: (query: string | undefined) => void
	onReconnectGitHub?: () => void
	onSelectAllRepositories: () => void
	onToggleRepository: (repositoryId: string) => void
	query: string
	repositories: GitHubImportRepository[]
	selectedRepositories: GitHubImportRepository[]
	selectedRepositoryIds: string[]
}

export function GitHubImportSourceSelector({
	error,
	hasNextPage,
	importError,
	isError,
	isFetchingNextPage,
	isFetchNextPageError,
	isImporting,
	isLoading,
	isSearching,
	onContinue,
	onLoadMore,
	onQueryChange,
	onReconnectGitHub,
	onSelectAllRepositories,
	onToggleRepository,
	query,
	repositories,
	selectedRepositories,
	selectedRepositoryIds,
}: Readonly<GitHubImportSourceSelectorProps>) {
	const selectedRepositoryIdSet = new Set(selectedRepositoryIds)
	const areAllLoadedSelected =
		repositories.length > 0 &&
		repositories.every(repository =>
			selectedRepositoryIdSet.has(repository.githubId)
		)
	const needsGitHubReconnect = isGitHubAccessError(error)

	if (isLoading) return <GitHubImportLoadingState />

	if (isError && !isFetchNextPageError)
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

	if (repositories.length === 0 && !hasNextPage && !query)
		return (
			<GitHubImportMessage
				description="No GitHub repositories are available for import yet."
				title="No repositories found"
			/>
		)

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
			<div className="flex flex-col gap-3">
				<SearchInput
					label="Search repositories"
					maxLength={GITHUB_IMPORT_SEARCH_MAX_LENGTH}
					onQueryChange={onQueryChange}
					placeholder="Search by owner or name"
					query={query}
				/>
				<div className="flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm">
						{selectedRepositoryIds.length} selected
					</p>
					<Button
						className="cursor-pointer transition duration-150 ease-out hover:-translate-y-px"
						onClick={onSelectAllRepositories}
						size="sm"
						variant="secondary"
					>
						{areAllLoadedSelected ? 'Deselect loaded' : 'Select all loaded'}
					</Button>
				</div>
				{repositories.length > 0 ? (
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
				) : (
					!hasNextPage && (
						<GitHubImportMessage
							description={`No repositories match "${query}".`}
							title="No repositories found"
						/>
					)
				)}
				{(repositories.length > 0 || hasNextPage) && (
					<GitHubImportLoadStatus
						hasLoadMoreError={isFetchNextPageError}
						hasNextPage={hasNextPage}
						isFetchingNextPage={isFetchingNextPage}
						isSearching={isSearching}
						loadedCount={repositories.length}
						onLoadMore={onLoadMore}
						query={query}
					/>
				)}
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
