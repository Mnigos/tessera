import type { MergeBlockingReason } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui/components/dialog'
import { Label } from '@repo/ui/components/label'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { getMergeBlockingReasonMessage } from '../helpers/merge-blocking-reason'

const BYPASS_REASON_MAX_LENGTH = 1000

interface PullRequestMergeBypassDialogProps {
	isPending: boolean
	/** The chosen method, named so the waiver says what it is waiving for. */
	mergeLabel: string
	onConfirm: (reason: string) => void
	reasons: MergeBlockingReason[]
	targetBranch: string
}

/**
 * Merging past requirements the rule allows an administrator to waive.
 *
 * The reason is mandatory and goes into the audit trail beside the merge, so it
 * is asked for here rather than assumed — a waiver nobody has to explain is a
 * waiver nobody can review.
 */
export function PullRequestMergeBypassDialog({
	isPending,
	mergeLabel,
	onConfirm,
	reasons,
	targetBranch,
}: Readonly<PullRequestMergeBypassDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const [reason, setReason] = useState('')
	const trimmedReason = reason.trim()

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) setReason('')
	}

	function handleConfirm() {
		if (!trimmedReason) return

		onConfirm(trimmedReason)
		setIsOpen(false)
		setReason('')
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger render={<Button size="sm" variant="outline" />}>
				<ShieldAlert className="size-4" />
				Merge anyway
			</DialogTrigger>
			<DialogContent>
				<div className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Merge past the branch protection rule</DialogTitle>
						<DialogDescription>
							This runs {mergeLabel.toLowerCase()} into {targetBranch} without
							satisfying the requirements below. The waiver is recorded on the
							pull request with your reason and the commits it was granted for.
						</DialogDescription>
					</DialogHeader>
					<ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground text-sm">
						{reasons.map(blockingReason => (
							<li key={blockingReason.code}>
								{getMergeBlockingReasonMessage(blockingReason)}
							</li>
						))}
					</ul>
					<div className="flex flex-col gap-2">
						<Label htmlFor="merge-bypass-reason">Reason</Label>
						<textarea
							autoFocus
							className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
							id="merge-bypass-reason"
							maxLength={BYPASS_REASON_MAX_LENGTH}
							onChange={event => setReason(event.target.value)}
							placeholder="Why this merge cannot wait for the requirements"
							required
							value={reason}
						/>
					</div>
					<DialogFooter>
						<DialogClose render={<Button variant="secondary" />}>
							Cancel
						</DialogClose>
						<Button
							disabled={!trimmedReason || isPending}
							onClick={handleConfirm}
						>
							{isPending ? 'Merging' : 'Merge anyway'}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	)
}
