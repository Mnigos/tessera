import type { MergeQueueStatus, PullRequest } from '@repo/contracts'
import type { MergeStrategy } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import { ListOrdered, LogOut, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import {
	getMergeBlockingReasonMessage,
	getMergeQueueStateLabel,
} from '../helpers/merge-blocking-reason'
import { getMergeStrategyLabel } from '../helpers/merge-strategy'
import { useJoinMergeQueueMutation } from '../hooks/use-join-merge-queue.mutation'
import { useLeaveMergeQueueMutation } from '../hooks/use-leave-merge-queue.mutation'
import { useRetryMergeQueueEntryMutation } from '../hooks/use-retry-merge-queue-entry.mutation'
import { PullRequestSquashDialog } from './pull-request-squash-dialog'

interface PullRequestMergeQueuePanelProps {
	username: string
	slug: string
	pullRequest: PullRequest
	mergeQueue: MergeQueueStatus
	/** The method the entry will be created with, fixed at that moment. */
	strategy: MergeStrategy
}

/**
 * Where this pull request stands in its repository's merge queue, and the three
 * things that can be done about it.
 *
 * The place shown is counted among the entries that can still run, so a paused
 * entry ahead of this one does not inflate it — nothing is waiting behind a
 * paused entry.
 */
export function PullRequestMergeQueuePanel({
	username,
	slug,
	pullRequest,
	mergeQueue,
	strategy,
}: Readonly<PullRequestMergeQueuePanelProps>) {
	const joinQueue = useJoinMergeQueueMutation()
	const leaveQueue = useLeaveMergeQueueMutation()
	const retryEntry = useRetryMergeQueueEntryMutation()
	const [isSquashRequested, setIsSquashRequested] = useState(false)
	// Closed once the entry exists, kept open when the join failed so whatever
	// was typed is still there to try again with.
	const isSquashDialogOpen = isSquashRequested && !joinQueue.isSuccess
	const input = { username, slug, number: pullRequest.number }
	const { entry } = mergeQueue
	const failedMutation = [joinQueue, leaveQueue, retryEntry].find(
		mutation => mutation.isError
	)

	return (
		<div className="flex flex-col gap-3 border-border/60 border-t pt-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="inline-flex items-center gap-2 font-medium text-sm">
					<ListOrdered aria-hidden className="size-4 text-muted-foreground" />
					Merge queue
				</span>
				<span className="text-muted-foreground text-xs">
					{mergeQueue.runnableCount === 1
						? '1 pull request waiting'
						: `${mergeQueue.runnableCount} pull requests waiting`}
				</span>
			</div>
			{entry ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm">
						{getMergeQueueStateLabel(entry.state)}
						{entry.position !== undefined && (
							<span className="text-muted-foreground">
								{' '}
								— number {entry.position} in line
							</span>
						)}
					</p>
					{/* The method was settled when the entry was created and the queue
					never re-chooses it, so it is reported rather than offered. */}
					<p className="text-muted-foreground text-xs">
						Will merge by {getMergeStrategyLabel(entry.strategy).toLowerCase()}
					</p>
					{entry.blockingReasons && entry.blockingReasons.length > 0 && (
						<ul className="flex list-disc flex-col gap-1 pl-4 text-muted-foreground text-xs">
							{entry.blockingReasons.map(reason => (
								<li key={reason.code}>
									{getMergeBlockingReasonMessage(reason)}
								</li>
							))}
						</ul>
					)}
					<div className="flex flex-wrap gap-2">
						{entry.state === 'paused' && (
							<Button
								disabled={retryEntry.isPending}
								onClick={() => retryEntry.mutate(input)}
								size="sm"
								variant="outline"
							>
								<RotateCcw className="size-4" />
								{retryEntry.isPending ? 'Retrying' : 'Retry'}
							</Button>
						)}
						{/* Git has the branch by the time an entry is merging, and the
						server refuses to withdraw it from under that. Offering the
						button anyway would only be a way to be told no. */}
						{entry.state !== 'merging' && (
							<Button
								disabled={leaveQueue.isPending}
								onClick={() => leaveQueue.mutate(input)}
								size="sm"
								variant="outline"
							>
								<LogOut className="size-4" />
								{leaveQueue.isPending ? 'Leaving' : 'Leave queue'}
							</Button>
						)}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<p className="text-muted-foreground text-sm">
						Queued pull requests merge one at a time, each re-checked against
						the target branch as it moves. This one would join as{' '}
						{getMergeStrategyLabel(strategy).toLowerCase()}.
					</p>
					{strategy === 'squash' ? (
						// The message is settled when the entry is created and never
						// re-derived, so it is asked for here rather than left to a
						// default the joiner never saw.
						<PullRequestSquashDialog
							defaultBody={pullRequest.body}
							defaultTitle={`${pullRequest.title} (#${pullRequest.number})`}
							isOpen={isSquashDialogOpen}
							isPending={joinQueue.isPending}
							onConfirm={({ squashBody, squashTitle }) =>
								joinQueue.mutate({
									...input,
									strategy: 'squash',
									squashTitle,
									squashBody,
								})
							}
							onOpenChange={setIsSquashRequested}
							targetBranch={pullRequest.targetBranch}
							trigger={
								<Button className="w-fit" size="sm" variant="outline">
									<ListOrdered className="size-4" />
									Join merge queue
								</Button>
							}
						/>
					) : (
						<Button
							className="w-fit"
							disabled={joinQueue.isPending}
							onClick={() => joinQueue.mutate({ ...input, strategy })}
							size="sm"
							variant="outline"
						>
							<ListOrdered className="size-4" />
							{joinQueue.isPending ? 'Joining' : 'Join merge queue'}
						</Button>
					)}
				</div>
			)}
			{failedMutation?.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						failedMutation.error,
						'The merge queue could not be updated.'
					)}
				</p>
			)}
		</div>
	)
}
