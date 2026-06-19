import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { RefreshCw } from 'lucide-react'
import { useSyncGitHubMirrorMutation } from '../hooks/use-sync-github-mirror.mutation'
import { RepositoryGitHubBackupMirrorPanel } from './repository-github-backup-mirror-panel'
import { GitHubMirrorCutoverSection } from './repository-github-mirror-cutover-section'
import {
	GitHubMirrorStatusBadge,
	MirrorTimestamp,
} from './repository-github-mirror-fields'
import { RepositoryTesseraSourcePanel } from './repository-tessera-source-panel'

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
	const syncMutation = useSyncGitHubMirrorMutation()

	if (externalSource.mode === 'none') return <NoGitHubMirrorPanel />

	if (externalSource.mode === 'tessera_source')
		return (
			<>
				<RepositoryTesseraSourcePanel externalSource={externalSource} />
				<RepositoryGitHubBackupMirrorPanel
					externalSource={externalSource}
					isCurrentOwner={isCurrentOwner}
					owner={owner}
					repository={repository}
				/>
			</>
		)

	const mirrorActions = getGitHubMirrorActions({
		externalSource,
		isCurrentOwner,
		isSyncPending: syncMutation.isPending,
	})

	function handleSync() {
		if (mirrorActions.sync.isDisabled) return

		syncMutation.mutate({
			slug: repository.slug,
			username: owner.username,
		})
	}

	return (
		<Card className="gap-4 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-semibold text-base tracking-normal">
							GitHub mirror
						</h2>
						<GitHubMirrorStatusBadge status={externalSource.syncStatus} />
					</div>
					<p className="text-muted-foreground text-sm">
						{externalSource.fullName}
					</p>
					<a
						className="break-all text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
						href={externalSource.sourceUrl}
						rel="noreferrer"
						target="_blank"
					>
						{externalSource.sourceUrl}
					</a>
				</div>
				{isCurrentOwner && (
					<Button
						className="w-full sm:w-auto"
						disabled={mirrorActions.sync.isDisabled}
						onClick={handleSync}
						size="sm"
						variant="secondary"
					>
						<RefreshCw className="size-4" />
						{syncMutation.isPending ? 'Syncing...' : 'Sync now'}
					</Button>
				)}
			</div>
			<div
				className={cn(
					'grid gap-3 text-sm',
					externalSource.nextSyncAt ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
				)}
			>
				{externalSource.nextSyncAt && (
					<MirrorTimestamp
						label="Next scheduled"
						value={externalSource.nextSyncAt}
					/>
				)}
				<MirrorTimestamp
					label="Last started"
					value={externalSource.lastSyncStartedAt}
				/>
				<MirrorTimestamp
					label="Last success"
					value={externalSource.lastSyncSucceededAt}
				/>
				<MirrorTimestamp
					label="Last failure"
					value={externalSource.lastSyncFailedAt}
				/>
			</div>
			{mirrorActions.sync.isLocked && (
				<p className="text-muted-foreground text-sm">
					Sync is {externalSource.syncStatus}.
				</p>
			)}
			{externalSource.syncFailureReason && (
				<p className="text-destructive text-sm">
					{externalSource.syncFailureReason}
				</p>
			)}
			{syncMutation.isSuccess && (
				<p className="text-emerald-700 text-sm">Sync queued.</p>
			)}
			{syncMutation.isError && (
				<p className="text-destructive text-sm">
					GitHub mirror sync could not be queued.
				</p>
			)}
			{mirrorActions.cutover.shouldShow && (
				<GitHubMirrorCutoverSection
					canCutover={mirrorActions.cutover.canStart}
					externalSource={externalSource}
					isSyncLocked={mirrorActions.sync.isLocked}
					owner={owner}
					repository={repository}
				/>
			)}
		</Card>
	)
}

interface GetGitHubMirrorActionsParams {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
	isCurrentOwner: boolean
	isSyncPending: boolean
}

function getGitHubMirrorActions({
	externalSource,
	isCurrentOwner,
	isSyncPending,
}: GetGitHubMirrorActionsParams) {
	const isMirror = externalSource.mode === 'github_to_tessera'
	const isSyncLocked =
		externalSource.syncStatus === 'pending' ||
		externalSource.syncStatus === 'running'
	const canSync = isCurrentOwner && !isSyncLocked
	const canCutover =
		isCurrentOwner && isMirror && externalSource.syncStatus === 'succeeded'

	return {
		sync: {
			canStart: canSync,
			isDisabled: !canSync || isSyncPending,
			isLocked: isSyncLocked,
		},
		cutover: {
			canStart: canCutover,
			shouldShow: canCutover || (isCurrentOwner && isMirror && isSyncLocked),
		},
	}
}

function NoGitHubMirrorPanel() {
	return (
		<Card className="border-dashed p-4">
			<h2 className="font-semibold text-base tracking-normal">GitHub mirror</h2>
			<p className="text-muted-foreground text-sm">
				This repository is not mirrored from GitHub.
			</p>
		</Card>
	)
}
