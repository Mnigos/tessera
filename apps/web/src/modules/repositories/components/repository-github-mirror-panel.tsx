import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { ArrowUpRight } from 'lucide-react'
import { useEnableGitHubMirrorMutation } from '../hooks/use-enable-github-mirror.mutation'
import { RepositoryDetentSourcePanel } from './repository-detent-source-panel'
import { GitHubMirrorCutoverSection } from './repository-github-mirror-cutover-section'
import { GitHubMirrorStatusBadge } from './repository-github-mirror-fields'

interface RepositoryGitHubMirrorPanelProps {
	isCurrentOwner: boolean
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryGitHubMirrorPanel({
	isCurrentOwner,
	owner,
	repository,
}: Readonly<RepositoryGitHubMirrorPanelProps>) {
	const externalSource = repository.externalSource

	if (externalSource.mode === 'none') return null
	if (externalSource.mode === 'tessera_source')
		return <RepositoryDetentSourcePanel externalSource={externalSource} />
	if (externalSource.mode === 'imported')
		return (
			<ImportedGitHubRepositoryPanel
				externalSource={externalSource}
				isCurrentOwner={isCurrentOwner}
				owner={owner}
				repository={repository}
			/>
		)

	const statusTimestamp = getSyncStatusTimestamp(externalSource)

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 flex-col gap-2">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<a
							className="inline-flex min-w-0 items-center gap-1 font-medium text-sm hover:text-primary"
							href={externalSource.sourceUrl}
							rel="noreferrer"
							target="_blank"
						>
							<span className="truncate">{externalSource.fullName}</span>
							<ArrowUpRight className="size-3 shrink-0" />
						</a>
						<span className="inline-flex rounded-md border border-border bg-secondary px-2 py-0.5 font-medium text-muted-foreground text-xs">
							GitHub → Tessera
						</span>
					</div>
					<GitHubMirrorStatusBadge
						status={externalSource.syncStatus}
						timestamp={statusTimestamp}
					/>
				</div>
				{isCurrentOwner && externalSource.syncStatus === 'succeeded' && (
					<GitHubMirrorCutoverSection owner={owner} repository={repository} />
				)}
			</div>
			{externalSource.syncFailureReason && (
				<p aria-live="polite" className="text-destructive text-sm">
					{externalSource.syncFailureReason}
				</p>
			)}
		</Card>
	)
}

interface ImportedGitHubRepositoryPanelProps {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
	isCurrentOwner: boolean
	owner: RepositoryOwner
	repository: Repository
}

function ImportedGitHubRepositoryPanel({
	externalSource,
	isCurrentOwner,
	owner,
	repository,
}: Readonly<ImportedGitHubRepositoryPanelProps>) {
	const enableMutation = useEnableGitHubMirrorMutation()

	function handleEnableMirror() {
		enableMutation.mutate({
			slug: repository.slug,
			username: owner.username,
		})
	}

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<h2 className="font-semibold text-sm tracking-normal">
						Not mirrored to GitHub
					</h2>
					<p className="text-muted-foreground text-sm">
						Connect the GitHub App to keep a mirror in sync automatically.
					</p>
					<a
						className="inline-flex max-w-full items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
						href={externalSource.sourceUrl}
						rel="noreferrer"
						target="_blank"
					>
						<span className="truncate">{externalSource.fullName}</span>
						<ArrowUpRight className="size-3 shrink-0" />
					</a>
				</div>
				{isCurrentOwner && (
					<Button
						disabled={enableMutation.isPending}
						onClick={handleEnableMirror}
						size="sm"
						variant="secondary"
					>
						{enableMutation.isPending ? 'Enabling…' : 'Enable mirror'}
					</Button>
				)}
			</div>
			{enableMutation.isError && (
				<p aria-live="polite" className="text-destructive text-sm">
					The mirror could not be enabled. Try again.
				</p>
			)}
		</Card>
	)
}

function getSyncStatusTimestamp(
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
) {
	if (externalSource.syncStatus === 'succeeded')
		return externalSource.lastSyncSucceededAt
	if (externalSource.syncStatus === 'failed')
		return externalSource.lastSyncFailedAt

	return externalSource.lastSyncStartedAt
}
