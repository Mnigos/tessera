import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, RefreshCw, ShieldAlert } from 'lucide-react'
import { type ChangeEvent, type ReactNode, useState } from 'react'
import { orpcQuery } from '@/lib/orpc/query'
import { CopyButton } from '@/shared/components/copy-button'
import {
	getRepositoryHttpCloneUrl,
	getRepositorySshCloneUrl,
} from '../helpers/get-repository-clone-url'
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

	if (externalSource.mode === 'none') return <NoGitHubMirrorPanel />

	if (externalSource.mode === 'tessera_source')
		return <TesseraSourcePanel externalSource={externalSource} />

	const isSyncLocked =
		externalSource.syncStatus === 'pending' ||
		externalSource.syncStatus === 'running'
	const isLatestSyncSucceeded = externalSource.syncStatus === 'succeeded'
	const canSync = isCurrentOwner && !isSyncLocked
	const isButtonDisabled = !canSync || syncMutation.isPending
	const isGitHubToTesseraMirror = externalSource.mode === 'github_to_tessera'
	const canCutover =
		isCurrentOwner && isGitHubToTesseraMirror && isLatestSyncSucceeded
	const canShowCutover =
		canCutover || (isCurrentOwner && isGitHubToTesseraMirror && isSyncLocked)

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
			{canShowCutover && (
				<GitHubMirrorCutoverSection
					canCutover={canCutover}
					externalSource={externalSource}
					isSyncLocked={isSyncLocked}
					owner={owner}
					repository={repository}
				/>
			)}
		</Card>
	)
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

interface TesseraSourcePanelProps {
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
}

function TesseraSourcePanel({
	externalSource,
}: Readonly<TesseraSourcePanelProps>) {
	return (
		<Card className="gap-4 p-4">
			<div className="flex flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold text-base tracking-normal">
						Repository source
					</h2>
					<span className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 text-xs">
						Tessera source of truth
					</span>
				</div>
				<p className="text-muted-foreground text-sm">
					GitHub mirror controls are hidden because writes now belong in
					Tessera.
				</p>
			</div>
			<div className="grid gap-3 text-sm sm:grid-cols-3">
				<SourceField label="GitHub source" value={externalSource.fullName} />
				<MirrorTimestamp label="Cut over" value={externalSource.cutoverAt} />
				<SourceField
					label="Previous mode"
					value={externalSource.cutoverFromMirrorMode ?? 'GitHub mirror'}
				/>
			</div>
		</Card>
	)
}

interface GitHubMirrorCutoverSectionProps {
	canCutover: boolean
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
	isSyncLocked: boolean
	owner: RepositoryOwner
	repository: Repository
}

function GitHubMirrorCutoverSection({
	canCutover,
	externalSource,
	isSyncLocked,
	owner,
	repository,
}: Readonly<GitHubMirrorCutoverSectionProps>) {
	const cutoverMutation = useCutoverGitHubMirrorMutation()
	const [isConfirmingCutover, setIsConfirmingCutover] = useState(false)
	const [isCutoverConfirmed, setIsCutoverConfirmed] = useState(false)
	const httpCloneUrl = getRepositoryHttpCloneUrl(repository, owner)
	const sshCloneUrl = getRepositorySshCloneUrl(repository, owner)
	const httpRemoteCommand = `git remote set-url origin ${httpCloneUrl}`
	const sshRemoteCommand = `git remote set-url origin ${sshCloneUrl}`
	const isCutoverDisabled =
		!canCutover ||
		isSyncLocked ||
		!isCutoverConfirmed ||
		cutoverMutation.isPending

	function handleCutover() {
		if (isCutoverDisabled) return

		cutoverMutation.mutate({
			slug: repository.slug,
			username: owner.username,
		})
	}

	function handleCutoverConfirmationChange(
		event: ChangeEvent<HTMLInputElement>
	) {
		setIsCutoverConfirmed(event.currentTarget.checked)
	}

	return (
		<div className="flex flex-col gap-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
			<div className="flex flex-col gap-2">
				<div className="flex items-start gap-2">
					<ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700" />
					<div className="flex flex-col gap-1">
						<h3 className="font-semibold text-sm tracking-normal">
							Cut over writes to Tessera
						</h3>
						<p className="text-muted-foreground text-sm">
							After confirmation, Tessera becomes the source of truth for{' '}
							{externalSource.fullName}. Pushes should target Tessera remotes,
							not GitHub.
						</p>
					</div>
				</div>
				<p className="text-muted-foreground text-sm">
					Migration guide: docs/github-cutover.md
				</p>
			</div>
			<div className="grid gap-3 text-sm sm:grid-cols-2">
				<SourceField label="GitHub source" value={externalSource.fullName} />
				<SourceField
					label="Default branch"
					value={externalSource.sourceDefaultBranch}
				/>
			</div>
			<div className="grid gap-3">
				<CommandBlock
					command={httpRemoteCommand}
					copiedLabel="HTTPS remote command copied"
					label="Copy HTTPS remote command"
					title="HTTPS remote"
				/>
				<CommandBlock
					command={sshRemoteCommand}
					copiedLabel="SSH remote command copied"
					label="Copy SSH remote command"
					title="SSH remote"
				/>
			</div>
			<ul className="grid gap-2 text-sm">
				<CutoverChecklistItem>
					Update local remotes to Tessera.
				</CutoverChecklistItem>
				<CutoverChecklistItem>
					Run fetch verification after switching remotes.
				</CutoverChecklistItem>
				<CutoverChecklistItem>
					Notify teammates before they push more work.
				</CutoverChecklistItem>
				<CutoverChecklistItem>
					Confirm GitHub mirror status is {externalSource.syncStatus}.
				</CutoverChecklistItem>
			</ul>
			{isSyncLocked && (
				<p className="text-muted-foreground text-sm">
					Cutover is unavailable while sync is {externalSource.syncStatus}.
				</p>
			)}
			{isConfirmingCutover ? (
				<div className="flex flex-col gap-3">
					<label className="flex items-start gap-2 text-sm">
						<input
							checked={isCutoverConfirmed}
							className="mt-1"
							onChange={handleCutoverConfirmationChange}
							type="checkbox"
						/>
						I updated remotes, verified fetch, notified teammates, and confirmed
						the GitHub mirror status.
					</label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							disabled={
								isCutoverConfirmed || isSyncLocked || cutoverMutation.isPending
							}
							onClick={() => setIsCutoverConfirmed(true)}
							size="sm"
							variant="secondary"
						>
							Confirm checklist
						</Button>
						<Button
							disabled={isCutoverDisabled}
							onClick={handleCutover}
							size="sm"
							variant="destructive"
						>
							{cutoverMutation.isPending
								? 'Cutting over...'
								: 'Cut over to Tessera'}
						</Button>
						<Button
							disabled={cutoverMutation.isPending}
							onClick={() => setIsConfirmingCutover(false)}
							size="sm"
							variant="secondary"
						>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<Button
					className="w-full sm:w-fit"
					disabled={!canCutover}
					onClick={() => setIsConfirmingCutover(true)}
					size="sm"
					variant="secondary"
				>
					<Copy className="size-4" />
					Review cutover
				</Button>
			)}
			{cutoverMutation.isSuccess && (
				<p className="text-emerald-700 text-sm">
					Cutover complete. Tessera is source of truth.
				</p>
			)}
			{cutoverMutation.isError && (
				<p className="text-destructive text-sm">
					GitHub mirror cutover could not be completed.
				</p>
			)}
		</div>
	)
}

function useCutoverGitHubMirrorMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.repositories.cutoverGitHubMirror.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: orpcQuery.repositories.getBrowserSummary.key(),
				})
			},
		})
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

interface SourceFieldProps {
	label: string
	value: string
}

function SourceField({ label, value }: Readonly<SourceFieldProps>) {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<span className="break-all">{value}</span>
		</div>
	)
}

interface CommandBlockProps {
	command: string
	copiedLabel: string
	label: string
	title: string
}

function CommandBlock({
	command,
	copiedLabel,
	label,
	title,
}: Readonly<CommandBlockProps>) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<h4 className="font-medium text-sm">{title}</h4>
				<CopyButton
					copiedLabel={copiedLabel}
					errorMessage="Could not copy remote command"
					label={label}
					text={command}
				/>
			</div>
			<pre className="overflow-x-auto rounded-md bg-background px-3 py-2 text-sm">
				<code>{command}</code>
			</pre>
		</div>
	)
}

interface CutoverChecklistItemProps {
	children: ReactNode
}

function CutoverChecklistItem({
	children,
}: Readonly<CutoverChecklistItemProps>) {
	return (
		<li className="flex items-start gap-2">
			<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
			<span>{children}</span>
		</li>
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
