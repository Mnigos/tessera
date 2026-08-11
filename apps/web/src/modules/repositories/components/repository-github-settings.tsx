import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useGitHubSyncHealthQuery } from '../hooks/use-github-sync-health.query'
import { useRepositoryQuery } from '../hooks/use-repository.query'
import { RepositoryBrowserMessage } from './repository-browser-message'
import { RepositoryGitHubEnableSection } from './repository-github-enable-section'
import { GitHubMirrorCutoverSection } from './repository-github-mirror-cutover-section'
import { RepositoryGitHubSourceDetails } from './repository-github-source-details'
import { RepositoryGitHubSyncHealthCard } from './repository-github-sync-health-card'

interface RepositoryGitHubSettingsProps {
	username: string
	slug: string
}

/**
 * Everything about where this repository comes from, in one place the overview
 * no longer has to carry: the source, how synchronization is doing, what to do
 * when access is lost, and the two configuration changes that exist.
 */
export function RepositoryGitHubSettings({
	username,
	slug,
}: Readonly<RepositoryGitHubSettingsProps>) {
	const repositoryQuery = useRepositoryQuery({ username, slug })

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{username}/{slug}
				</p>
				<h1 className="font-semibold text-3xl tracking-normal">GitHub</h1>
				<p className="text-muted-foreground text-sm">
					Where this repository comes from, how current it is, and who owns it
					now.
				</p>
			</header>
			<RepositoryGitHubSettingsBody
				isError={repositoryQuery.isError}
				isLoading={repositoryQuery.isLoading}
				owner={repositoryQuery.data?.owner}
				repository={repositoryQuery.data?.repository}
				slug={slug}
				username={username}
			/>
		</section>
	)
}

interface RepositoryGitHubSettingsBodyProps
	extends RepositoryGitHubSettingsProps {
	isError: boolean
	isLoading: boolean
	owner?: RepositoryOwner
	repository?: Repository
}

function RepositoryGitHubSettingsBody({
	isError,
	isLoading,
	owner,
	repository,
	slug,
	username,
}: Readonly<RepositoryGitHubSettingsBodyProps>) {
	// Health is only meaningful while a mirror is running; asking for it on an
	// imported snapshot or after cutover would be a read with nothing to answer.
	const isMirrored = repository?.externalSource.mode === 'github_to_tessera'
	const syncHealthQuery = useGitHubSyncHealthQuery(
		{ slug, username },
		isMirrored
	)

	if (isLoading)
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-32" />
				<Skeleton className="h-24" />
			</div>
		)

	if (isError || !(repository && owner))
		return (
			<RepositoryBrowserMessage title="GitHub settings could not be loaded">
				The GitHub source for this repository could not be loaded.
			</RepositoryBrowserMessage>
		)

	const externalSource = repository.externalSource

	if (externalSource.mode === 'none')
		return (
			<RepositoryBrowserMessage title="No GitHub source">
				This repository was created in Tessera and has no GitHub source.
			</RepositoryBrowserMessage>
		)

	return (
		<>
			<RepositoryGitHubSourceDetails externalSource={externalSource} />
			{externalSource.mode === 'imported' && (
				<RepositoryGitHubEnableSection owner={owner} repository={repository} />
			)}
			{isMirrored && (
				<>
					<RepositoryGitHubSyncHealthCard
						isError={syncHealthQuery.isError}
						isLoading={syncHealthQuery.isLoading}
						slug={slug}
						syncHealth={syncHealthQuery.data?.syncHealth}
						username={username}
					/>
					<GitHubMirrorCutoverSection
						isSyncHealthLoading={syncHealthQuery.isLoading}
						owner={owner}
						repository={repository}
						syncHealth={syncHealthQuery.data?.syncHealth}
					/>
				</>
			)}
		</>
	)
}
