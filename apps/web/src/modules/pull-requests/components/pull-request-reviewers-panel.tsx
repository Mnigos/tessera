import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { History, X } from 'lucide-react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { formatPullRequestDate } from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewerEntries,
	getPullRequestReviewOutcomePresentation,
	type PullRequestReviewerEntry,
} from '../helpers/pull-request-review'
import { useRemovePullRequestReviewerRequestMutation } from '../hooks/use-remove-pull-request-reviewer-request.mutation'
import { PullRequestRequestReviewerForm } from './pull-request-request-reviewer-form'
import { PullRequestReviewDialog } from './pull-request-review-dialog'

interface PullRequestReviewersPanelProps {
	username: string
	slug: string
	number: string
	reviewerRequests: readonly PullRequestReviewerRequest[]
	effectiveReviewStates: readonly PullRequestEffectiveReviewState[]
	reviewerCandidates: readonly PullRequestReviewerCandidate[]
	viewer: PullRequestReviewViewer
	isOpen: boolean
	headSha?: string
	pendingCommentCount?: number
}

export function PullRequestReviewersPanel({
	username,
	slug,
	number,
	reviewerRequests,
	effectiveReviewStates,
	reviewerCandidates,
	viewer,
	isOpen,
	headSha,
	pendingCommentCount,
}: Readonly<PullRequestReviewersPanelProps>) {
	const removeRequest = useRemovePullRequestReviewerRequestMutation()

	const entries = getPullRequestReviewerEntries(
		reviewerRequests,
		effectiveReviewStates
	)

	function handleRemove(reviewerUsername: string) {
		removeRequest.mutate({ username, slug, number, reviewerUsername })
	}

	return (
		<Card className="gap-4">
			<h2 className="font-semibold text-base tracking-normal">Reviewers</h2>
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-sm italic">
					No reviews requested yet.
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{entries.map(entry => (
						<PullRequestReviewerRow
							canRemove={viewer.canRemoveReviewerRequests && isOpen}
							entry={entry}
							isRemoving={
								removeRequest.isPending &&
								removeRequest.variables?.reviewerUsername === entry.username
							}
							key={entry.username}
							onRemove={() => handleRemove(entry.username)}
						/>
					))}
				</ul>
			)}
			{removeRequest.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						removeRequest.error,
						'The review request could not be removed.'
					)}
				</p>
			)}
			{viewer.canRequestReviewers && isOpen && (
				<PullRequestRequestReviewerForm
					candidates={reviewerCandidates}
					listedUsernames={entries.map(entry => entry.username)}
					number={number}
					slug={slug}
					username={username}
				/>
			)}
			{viewer.canSubmitReview && isOpen && (
				<div className="flex border-border border-t pt-3">
					<PullRequestReviewDialog
						headSha={headSha}
						number={number}
						pendingCommentCount={pendingCommentCount}
						slug={slug}
						triggerLabel="Review changes"
						username={username}
					/>
				</div>
			)}
		</Card>
	)
}

interface PullRequestReviewerRowProps {
	entry: PullRequestReviewerEntry
	canRemove: boolean
	isRemoving: boolean
	onRemove: () => void
}

function PullRequestReviewerRow({
	entry,
	canRemove,
	isRemoving,
	onRemove,
}: Readonly<PullRequestReviewerRowProps>) {
	const presentation = getPullRequestReviewOutcomePresentation(entry.outcome)
	const reviewedAt = entry.submittedAt

	return (
		<li className="flex min-w-0 items-start gap-2">
			<presentation.icon
				aria-hidden
				className={cn('mt-0.5 size-4 shrink-0', presentation.iconClassName)}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-medium text-sm" title={entry.username}>
					{entry.username}
				</span>
				<span
					className="text-muted-foreground text-xs"
					title={
						reviewedAt
							? `${presentation.label} on ${formatPullRequestDate(reviewedAt)}`
							: undefined
					}
				>
					{presentation.label}
				</span>
				{(entry.stale || (entry.outcome && entry.isRequested)) && (
					<span className="flex flex-wrap items-center gap-1.5">
						{entry.stale && (
							<span
								className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400 text-xs"
								title="This review predates the current changes."
							>
								<History aria-hidden className="size-3" />
								Stale
							</span>
						)}
						{entry.outcome && entry.isRequested && (
							<span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
								Re-requested
							</span>
						)}
					</span>
				)}
			</div>
			{canRemove && entry.isRequested && (
				<Button
					aria-label={`Remove review request for ${entry.username}`}
					className="size-7 shrink-0 text-muted-foreground"
					disabled={isRemoving}
					onClick={onRemove}
					size="icon"
					variant="ghost"
				>
					<X />
				</Button>
			)}
		</li>
	)
}
