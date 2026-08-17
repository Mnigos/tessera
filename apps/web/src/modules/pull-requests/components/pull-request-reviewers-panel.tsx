import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { GitCompareArrows, History, X } from 'lucide-react'
import { formatPullRequestDate } from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewerEntries,
	getPullRequestReviewOutcomePresentation,
	type PullRequestReviewerEntry,
} from '../helpers/pull-request-review'
import { useRemovePullRequestReviewerRequestMutation } from '../hooks/use-remove-pull-request-reviewer-request.mutation'
import { PullRequestErrorMessage } from './pull-request-error-message'
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
	isGitHubAuthoritative: boolean
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
	isGitHubAuthoritative,
	isOpen,
	headSha,
	pendingCommentCount,
}: Readonly<PullRequestReviewersPanelProps>) {
	const removeRequest = useRemovePullRequestReviewerRequestMutation()

	const entries = getPullRequestReviewerEntries(
		reviewerRequests,
		effectiveReviewStates
	)

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
								removeRequest.variables?.reviewerUsername ===
									entry.reviewer.username
							}
							key={entry.key}
							number={number}
							onRemove={() =>
								removeRequest.mutate({
									username,
									slug,
									number,
									reviewerUsername: entry.reviewer.username,
								})
							}
							slug={slug}
							username={username}
						/>
					))}
				</ul>
			)}
			{removeRequest.isError && (
				<PullRequestErrorMessage
					error={removeRequest.error}
					fallback="The review request could not be removed."
				/>
			)}
			{viewer.canRequestReviewers && isOpen && (
				<PullRequestRequestReviewerForm
					candidates={reviewerCandidates}
					listedUsernames={entries.map(entry => entry.reviewer.username)}
					number={number}
					slug={slug}
					username={username}
				/>
			)}
			{viewer.canSubmitReview && isOpen && (
				<div className="flex border-border border-t pt-3">
					<PullRequestReviewDialog
						headSha={headSha}
						isGitHubAuthoritative={isGitHubAuthoritative}
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
	username: string
	slug: string
	number: string
	entry: PullRequestReviewerEntry
	canRemove: boolean
	isRemoving: boolean
	onRemove: () => void
}

function PullRequestReviewerRow({
	username,
	slug,
	number,
	entry,
	canRemove,
	isRemoving,
	onRemove,
}: Readonly<PullRequestReviewerRowProps>) {
	const presentation = getPullRequestReviewOutcomePresentation(entry.outcome)
	const reviewedAt = entry.submittedAt
	const { reviewer } = entry

	return (
		<li className="flex min-w-0 items-start gap-2">
			<presentation.icon
				aria-hidden
				className={cn('mt-0.5 size-4 shrink-0', presentation.iconClassName)}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className="truncate font-medium text-sm"
					title={reviewer.username}
				>
					{reviewer.htmlUrl ? (
						<a
							className="hover:underline"
							href={reviewer.htmlUrl}
							rel="noreferrer"
							target="_blank"
						>
							{reviewer.username}
						</a>
					) : (
						reviewer.username
					)}
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
				{entry.reviewId && (
					<Link
						aria-label={`View changes since ${reviewer.username} reviewed`}
						className="inline-flex w-fit items-center gap-1 text-muted-foreground text-xs hover:underline"
						params={{ username, slug, number }}
						search={{ reviewId: entry.reviewId }}
						title={
							entry.headSha
								? `The review was left against ${entry.headSha}`
								: undefined
						}
						to="/$username/$slug/pulls/$number/files"
					>
						<GitCompareArrows aria-hidden className="size-3" />
						View changes since
					</Link>
				)}
			</div>
			{canRemove && entry.isRequested && (
				<Button
					aria-label={`Remove review request for ${reviewer.username}`}
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
