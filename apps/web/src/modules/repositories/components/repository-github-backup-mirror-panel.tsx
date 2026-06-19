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
				<RepositoryGitHubBackupMirrorActions
					isCurrentOwner={isCurrentOwner}
					isDisablePending={disableMutation.isPending}
					isEnabled={isEnabled}
					isEnablePending={enableMutation.isPending}
					isPushDisabled={isPushDisabled}
					isPushPending={pushMutation.isPending}
					isSettingsDisabled={isSettingsDisabled}
					onDisable={handleDisable}
					onEnable={handleEnable}
					onPush={handlePush}
				/>
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
			<RepositoryGitHubBackupMirrorFeedback
				failureReason={externalSource.githubPushBackFailureReason}
				hasPushError={pushMutation.isError}
				hasSettingsError={enableMutation.isError || disableMutation.isError}
				isDisableSuccess={disableMutation.isSuccess}
				isEnableSuccess={enableMutation.isSuccess}
				isPushSuccess={pushMutation.isSuccess}
				isRunning={isRunning}
			/>
		</Card>
	)
}

interface RepositoryGitHubBackupMirrorActionsProps {
	isCurrentOwner: boolean
	isDisablePending: boolean
	isEnablePending: boolean
	isEnabled: boolean
	isPushDisabled: boolean
	isPushPending: boolean
	isSettingsDisabled: boolean
	onDisable: () => void
	onEnable: () => void
	onPush: () => void
}

function RepositoryGitHubBackupMirrorActions({
	isCurrentOwner,
	isDisablePending,
	isEnablePending,
	isEnabled,
	isPushDisabled,
	isPushPending,
	isSettingsDisabled,
	onDisable,
	onEnable,
	onPush,
}: Readonly<RepositoryGitHubBackupMirrorActionsProps>) {
	if (!isCurrentOwner) return null

	return (
		<div className="flex flex-col gap-2 sm:flex-row">
			{isEnabled ? (
				<Button
					disabled={isSettingsDisabled}
					onClick={onDisable}
					size="sm"
					variant="secondary"
				>
					<Power className="size-4" />
					{isDisablePending ? 'Disabling...' : 'Disable backup'}
				</Button>
			) : (
				<Button
					disabled={isSettingsDisabled}
					onClick={onEnable}
					size="sm"
					variant="secondary"
				>
					<Power className="size-4" />
					{isEnablePending ? 'Enabling...' : 'Enable backup'}
				</Button>
			)}
			<Button
				disabled={isPushDisabled}
				onClick={onPush}
				size="sm"
				variant="secondary"
			>
				<RefreshCw className="size-4" />
				{isPushPending ? 'Pushing...' : 'Push now'}
			</Button>
		</div>
	)
}

interface RepositoryGitHubBackupMirrorFeedbackProps {
	failureReason: string | undefined
	hasPushError: boolean
	hasSettingsError: boolean
	isDisableSuccess: boolean
	isEnableSuccess: boolean
	isPushSuccess: boolean
	isRunning: boolean
}

function RepositoryGitHubBackupMirrorFeedback({
	failureReason,
	hasPushError,
	hasSettingsError,
	isDisableSuccess,
	isEnableSuccess,
	isPushSuccess,
	isRunning,
}: Readonly<RepositoryGitHubBackupMirrorFeedbackProps>) {
	return (
		<>
			{isRunning && (
				<p className="text-muted-foreground text-sm">Backup push is running.</p>
			)}
			{failureReason && (
				<p className="text-destructive text-sm">{failureReason}</p>
			)}
			{isEnableSuccess && (
				<p className="text-emerald-700 text-sm">Backup mirror enabled.</p>
			)}
			{isDisableSuccess && (
				<p className="text-emerald-700 text-sm">Backup mirror disabled.</p>
			)}
			{isPushSuccess && (
				<p className="text-emerald-700 text-sm">Backup push completed.</p>
			)}
			{hasSettingsError && (
				<p className="text-destructive text-sm">
					Backup mirror settings could not be updated.
				</p>
			)}
			{hasPushError && (
				<p className="text-destructive text-sm">
					Backup mirror push could not be completed.
				</p>
			)}
		</>
	)
}
