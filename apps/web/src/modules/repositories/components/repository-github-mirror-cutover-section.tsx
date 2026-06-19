import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { CheckCircle2, Copy, ShieldAlert } from 'lucide-react'
import { type ChangeEvent, type ReactNode, useState } from 'react'
import { CopyButton } from '@/shared/components/copy-button'
import {
	getRepositoryHttpCloneUrl,
	getRepositorySshCloneUrl,
} from '../helpers/get-repository-clone-url'
import { useCutoverGitHubMirrorMutation } from '../hooks/use-cutover-github-mirror.mutation'
import { SourceField } from './repository-github-mirror-fields'

interface GitHubMirrorCutoverSectionProps {
	canCutover: boolean
	externalSource: Exclude<Repository['externalSource'], { mode: 'none' }>
	isSyncLocked: boolean
	owner: RepositoryOwner
	repository: Repository
}

export function GitHubMirrorCutoverSection({
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
