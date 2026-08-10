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
import { GitMerge } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { getMergeBlockingReasonMessage } from '../helpers/merge-blocking-reason'

const SQUASH_TITLE_MAX_LENGTH = 256
const SQUASH_BODY_MAX_LENGTH = 65_536
const BYPASS_REASON_MAX_LENGTH = 1000

export interface PullRequestSquashMessage {
	squashBody: string
	squashTitle: string
}

export interface PullRequestSquashConfirmation
	extends PullRequestSquashMessage {
	/** Present only when this squash is also waiving branch protection. */
	bypassReason?: string
}

interface PullRequestSquashDialogProps {
	/**
	 * The requirements this squash would waive. Present only when the merge needs
	 * a waiver, which is what turns this into one confirmation instead of two.
	 */
	bypassReasons?: MergeBlockingReason[]
	defaultBody: string
	defaultTitle: string
	isOpen: boolean
	isPending: boolean
	onConfirm: (confirmation: PullRequestSquashConfirmation) => void
	onOpenChange: (open: boolean) => void
	targetBranch: string
	trigger: ReactElement
}

/**
 * The one commit a squash will leave behind, before it is written.
 *
 * The fields are prefilled from the pull request because that is what the
 * server would derive anyway, and they are editable because the combined commit
 * is the only record of this work that the target branch will keep — its
 * message is worth a moment's attention.
 *
 * When the squash also waives branch protection, the waiver is asked for here
 * rather than in a dialog of its own: they are one decision, and splitting them
 * would leave the reader waiving policy without ever seeing the commit message
 * their waiver is for.
 *
 * Whether it is open is the caller's to decide, because only the caller knows
 * whether the merge went through. Closing on confirm would hide the merge while
 * it was still running and throw away an edited message the moment it failed —
 * exactly when the reader most needs it back.
 */
export function PullRequestSquashDialog({
	bypassReasons,
	defaultBody,
	defaultTitle,
	isOpen,
	isPending,
	onConfirm,
	onOpenChange,
	targetBranch,
	trigger,
}: Readonly<PullRequestSquashDialogProps>) {
	const [message, setMessage] = useState<PullRequestSquashMessage>({
		squashTitle: defaultTitle,
		squashBody: defaultBody,
	})
	const [bypassReason, setBypassReason] = useState('')
	const trimmedTitle = message.squashTitle.trim()
	const trimmedBypassReason = bypassReason.trim()
	const isWaiving = Boolean(bypassReasons?.length)
	const canConfirm =
		Boolean(trimmedTitle) && (!isWaiving || Boolean(trimmedBypassReason))

	// Reopening starts from the pull request again rather than from whatever was
	// abandoned last time, which is what a reader expects of a dialog they closed
	// without merging. A merge that failed is not that: it keeps what was typed,
	// because the caller leaves the dialog open.
	function handleOpenChange(open: boolean) {
		onOpenChange(open)

		if (open) {
			setMessage({ squashTitle: defaultTitle, squashBody: defaultBody })
			setBypassReason('')
		}
	}

	function handleConfirm() {
		if (!canConfirm) return

		onConfirm({
			squashTitle: trimmedTitle,
			squashBody: message.squashBody,
			bypassReason: isWaiving ? trimmedBypassReason : undefined,
		})
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<div className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>
							{isWaiving ? 'Squash and merge anyway' : 'Squash and merge'}
						</DialogTitle>
						<DialogDescription>
							Every commit on this branch becomes one commit on {targetBranch}.
							This is the message it will carry.
						</DialogDescription>
					</DialogHeader>
					{bypassReasons && bypassReasons.length > 0 && (
						<div className="flex flex-col gap-2">
							<p className="font-medium text-sm">
								This merges without satisfying:
							</p>
							<ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground text-sm">
								{bypassReasons.map(reason => (
									<li key={reason.code}>
										{getMergeBlockingReasonMessage(reason)}
									</li>
								))}
							</ul>
						</div>
					)}
					<div className="flex flex-col gap-2">
						<Label htmlFor="squash-title">Title</Label>
						<input
							autoFocus
							className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
							id="squash-title"
							maxLength={SQUASH_TITLE_MAX_LENGTH}
							onChange={event =>
								setMessage(current => ({
									...current,
									squashTitle: event.target.value,
								}))
							}
							required
							value={message.squashTitle}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="squash-body">Description</Label>
						<textarea
							className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
							id="squash-body"
							maxLength={SQUASH_BODY_MAX_LENGTH}
							onChange={event =>
								setMessage(current => ({
									...current,
									squashBody: event.target.value,
								}))
							}
							placeholder="What this change does, for whoever reads the branch later"
							value={message.squashBody}
						/>
					</div>
					{isWaiving && (
						<div className="flex flex-col gap-2">
							<Label htmlFor="squash-bypass-reason">
								Reason for the waiver
							</Label>
							<textarea
								className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
								id="squash-bypass-reason"
								maxLength={BYPASS_REASON_MAX_LENGTH}
								onChange={event => setBypassReason(event.target.value)}
								placeholder="Why this merge cannot wait for the requirements"
								required
								value={bypassReason}
							/>
						</div>
					)}
					<DialogFooter>
						<DialogClose render={<Button variant="secondary" />}>
							Cancel
						</DialogClose>
						<Button disabled={!canConfirm || isPending} onClick={handleConfirm}>
							<GitMerge className="size-4" />
							{isPending ? 'Merging' : 'Squash and merge'}
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	)
}
