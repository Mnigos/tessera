import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { RefreshCw } from 'lucide-react'
import { useSyncGitHubMirrorMutation } from '../hooks/use-sync-github-mirror.mutation'

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short',
})

const SYNC_STATUS_LABELS = {
	pending: 'Pending',
	running: 'Running',
	succeeded: 'Succeeded',
	failed: 'Failed',
} satisfies Record<string, string>

const SYNC_STATUS_CLASS_NAMES = {
	pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
	running: 'border-blue-500/30 bg-blue-500/10 text-blue-700',
	succeeded: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
	failed: 'border-destructive/40 bg-destructive/10 text-destructive',
} satisfies Record<string, string>

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

	if (externalSource.mode === 'none')
		return (
			<Card className="border-dashed p-4">
				<h2 className="font-semibold text-base tracking-normal">
					GitHub mirror
				</h2>
				<p className="text-muted-foreground text-sm">
					This repository is not mirrored from GitHub.
				</p>
			</Card>
		)

	const isSyncLocked =
		externalSource.syncStatus === 'pending' ||
		externalSource.syncStatus === 'running'
	const canSync = isCurrentOwner && !isSyncLocked
	const isButtonDisabled = !canSync || syncMutation.isPending

	function handleSync() {
		if (isButtonDisabled) return

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
						disabled={isButtonDisabled}
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
				className={`grid gap-3 text-sm ${
					externalSource.nextSyncAt ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
				}`}
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
			{isSyncLocked && (
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
		</Card>
	)
}

interface GitHubMirrorStatusBadgeProps {
	status: Exclude<Repository['externalSource'], { mode: 'none' }>['syncStatus']
}

function GitHubMirrorStatusBadge({
	status,
}: Readonly<GitHubMirrorStatusBadgeProps>) {
	return (
		<span
			className={`inline-flex rounded-md border px-2 py-0.5 font-medium text-xs ${SYNC_STATUS_CLASS_NAMES[status]}`}
		>
			{SYNC_STATUS_LABELS[status]}
		</span>
	)
}

interface MirrorTimestampProps {
	label: string
	value?: Date | number | string
}

function MirrorTimestamp({ label, value }: Readonly<MirrorTimestampProps>) {
	const date = value ? new Date(value) : undefined
	const labelText =
		date && !Number.isNaN(date.getTime())
			? DATE_FORMATTER.format(date)
			: 'Never'

	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<span suppressHydrationWarning>{labelText}</span>
		</div>
	)
}
