import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Power, RefreshCw } from 'lucide-react'
import { useDisableGitHubPushBackMutation } from '../hooks/use-disable-github-push-back.mutation'
import { useEnableGitHubPushBackMutation } from '../hooks/use-enable-github-push-back.mutation'
import { usePushGitHubPushBackMirrorMutation } from '../hooks/use-push-github-push-back-mirror.mutation'
import {
	GitHubMirrorStatusBadge,
	MirrorTimestamp,
	SourceField,
} from './repository-github-mirror-fields'

interface RepositoryGitHubBackupMirrorPanelProps {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
	isCurrentOwner: boolean
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryGitHubBackupMirrorPanel({
	externalSource,
	isCurrentOwner,
	owner,
	repository,
}: Readonly<RepositoryGitHubBackupMirrorPanelProps>) {
	const enableMutation = useEnableGitHubPushBackMutation()
	const disableMutation = useDisableGitHubPushBackMutation()
	const pushMutation = usePushGitHubPushBackMirrorMutation()
	const isEnabled = externalSource.githubPushBackEnabled === true
	const status = externalSource.githubPushBackStatus ?? 'idle'
	const isRunning = status === 'running'
	const isAnyPending =
		enableMutation.isPending ||
		disableMutation.isPending ||
		pushMutation.isPending
	const isSettingsDisabled = isAnyPending || isRunning
	const isPushDisabled = !isEnabled || isRunning || isAnyPending
	const actionInput = {
		slug: repository.slug,
		username: owner.username,
	}

	function handleEnable() {
		if (isSettingsDisabled) return

		enableMutation.mutate(actionInput)
	}

	function handleDisable() {
		if (isSettingsDisabled) return

		disableMutation.mutate(actionInput)
	}

	function handlePush() {
		if (isPushDisabled) return

		pushMutation.mutate(actionInput)
	}

	return (
		<Card className="gap-4 p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-semibold text-base tracking-normal">
							GitHub backup mirror
						</h2>
						<GitHubMirrorStatusBadge status={status} />
					</div>
					<p className="text-muted-foreground text-sm">
						Optional backup copy. Tessera remains source of truth.
					</p>
				</div>
				{isCurrentOwner && (
					<div className="flex flex-col gap-2 sm:flex-row">
						{isEnabled ? (
							<Button
								disabled={isSettingsDisabled}
								onClick={handleDisable}
								size="sm"
								variant="secondary"
							>
								<Power className="size-4" />
								{disableMutation.isPending ? 'Disabling...' : 'Disable backup'}
							</Button>
						) : (
							<Button
								disabled={isSettingsDisabled}
								onClick={handleEnable}
								size="sm"
								variant="secondary"
							>
								<Power className="size-4" />
								{enableMutation.isPending ? 'Enabling...' : 'Enable backup'}
							</Button>
						)}
						<Button
							disabled={isPushDisabled}
							onClick={handlePush}
							size="sm"
							variant="secondary"
						>
							<RefreshCw className="size-4" />
							{pushMutation.isPending ? 'Pushing...' : 'Push now'}
						</Button>
					</div>
				)}
			</div>
			<div className="grid gap-3 text-sm sm:grid-cols-4">
				<SourceField label="Backup target" value={externalSource.fullName} />
				<MirrorTimestamp
					label="Last started"
					value={externalSource.githubPushBackStartedAt}
				/>
				<MirrorTimestamp
					label="Last success"
					value={externalSource.githubPushBackSucceededAt}
				/>
				<MirrorTimestamp
					label="Last failure"
					value={externalSource.githubPushBackFailedAt}
				/>
			</div>
			{isRunning && (
				<p className="text-muted-foreground text-sm">Backup push is running.</p>
			)}
			{externalSource.githubPushBackFailureReason && (
				<p className="text-destructive text-sm">
					{externalSource.githubPushBackFailureReason}
				</p>
			)}
			{enableMutation.isSuccess && (
				<p className="text-emerald-700 text-sm">Backup mirror enabled.</p>
			)}
			{disableMutation.isSuccess && (
				<p className="text-emerald-700 text-sm">Backup mirror disabled.</p>
			)}
			{pushMutation.isSuccess && (
				<p className="text-emerald-700 text-sm">Backup push completed.</p>
			)}
			{(enableMutation.isError || disableMutation.isError) && (
				<p className="text-destructive text-sm">
					Backup mirror settings could not be updated.
				</p>
			)}
			{pushMutation.isError && (
				<p className="text-destructive text-sm">
					Backup mirror push could not be completed.
				</p>
			)}
		</Card>
	)
}
