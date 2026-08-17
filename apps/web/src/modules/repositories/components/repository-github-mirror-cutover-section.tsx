import type {
	Repository,
	RepositoryOwner,
	RepositorySyncHealth,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Skeleton } from '@repo/ui/components/skeleton'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { getRepositoryCutoverBlockReason } from '../helpers/repository-sync-health'
import { useCutoverGitHubMirrorMutation } from '../hooks/use-cutover-github-mirror.mutation'

interface GitHubMirrorCutoverSectionProps {
	owner: RepositoryOwner
	repository: Repository
	syncHealth?: RepositorySyncHealth
	/** Health still in flight is unknown, which is not the same as unavailable. */
	isSyncHealthLoading: boolean
}

/**
 * The one irreversible thing on this page.
 *
 * The server refuses a cutover unless the mirror has converged, because a run
 * that merely finished can still have left GitHub data behind — and after the
 * switch there is no synchronization left to go and collect it. So the refusal
 * is stated here in the terms of whatever is standing in the way, rather than
 * offered as a button that fails.
 */
export function GitHubMirrorCutoverSection({
	owner,
	repository,
	syncHealth,
	isSyncHealthLoading,
}: Readonly<GitHubMirrorCutoverSectionProps>) {
	const cutoverMutation = useCutoverGitHubMirrorMutation()
	const [isConfirmingCutover, setIsConfirmingCutover] = useState(false)
	const blockReason = getRepositoryCutoverBlockReason(syncHealth)

	function handleCutover() {
		if (cutoverMutation.isPending) return

		cutoverMutation.mutate({
			slug: repository.slug,
			username: owner.handle,
		})
	}

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Make Tessera the source of truth
				</h2>
				<p className="text-muted-foreground text-sm">
					This stops GitHub-to-Tessera synchronization and lets Tessera accept
					writes again. It cannot be undone.
				</p>
			</div>
			{isSyncHealthLoading && <Skeleton className="h-8 max-w-56" />}
			{!isSyncHealthLoading && blockReason && (
				<p className="text-amber-400 text-sm">{blockReason}</p>
			)}
			{/* Once authority has changed there is nothing left to offer: the button
			    would invite a second, now-meaningless request while the success
			    message sits beside it. */}
			{!(cutoverMutation.isSuccess || isSyncHealthLoading || blockReason) && (
				<CutoverControls
					isConfirming={isConfirmingCutover}
					isPending={cutoverMutation.isPending}
					onCancel={() => setIsConfirmingCutover(false)}
					onConfirm={handleCutover}
					onStart={() => setIsConfirmingCutover(true)}
				/>
			)}
			{cutoverMutation.isSuccess && (
				<output className="text-emerald-400 text-sm">
					Tessera is now authoritative.
				</output>
			)}
			{cutoverMutation.isError && (
				<p className="text-destructive text-sm" role="alert">
					Authority could not be changed. Try again.
				</p>
			)}
		</Card>
	)
}

interface CutoverControlsProps {
	isConfirming: boolean
	isPending: boolean
	onCancel: () => void
	onConfirm: () => void
	onStart: () => void
}

function CutoverControls({
	isConfirming,
	isPending,
	onCancel,
	onConfirm,
	onStart,
}: Readonly<CutoverControlsProps>) {
	if (!isConfirming)
		return (
			<div>
				<Button onClick={onStart} size="sm" variant="secondary">
					Make Tessera authoritative
				</Button>
			</div>
		)

	return (
		<div className="flex max-w-xl flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
			<div className="flex items-start gap-2 text-sm">
				<ShieldAlert
					aria-hidden
					className="mt-0.5 size-4 shrink-0 text-amber-400"
				/>
				<p>
					This stops GitHub-to-Tessera synchronization. Future writes must
					target Tessera.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={isPending}
					onClick={onConfirm}
					size="sm"
					variant="destructive"
				>
					{isPending ? 'Changing authority…' : 'Confirm authority change'}
				</Button>
				<Button
					disabled={isPending}
					onClick={onCancel}
					size="sm"
					variant="secondary"
				>
					Cancel
				</Button>
			</div>
		</div>
	)
}
