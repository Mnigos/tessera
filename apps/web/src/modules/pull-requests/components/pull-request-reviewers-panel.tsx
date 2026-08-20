import type {
	PullRequestEffectiveReviewState,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@repo/ui/components/popover'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { GitCompareArrows, History, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { formatPullRequestDate } from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewerEntries,
	getPullRequestReviewOutcomePresentation,
	type PullRequestReviewerEntry,
} from '../helpers/pull-request-review'
import { useRemovePullRequestReviewerRequestMutation } from '../hooks/use-remove-pull-request-reviewer-request.mutation'
import { PullRequestActorLabel } from './pull-request-actor-label'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestRequestReviewerForm } from './pull-request-request-reviewer-form'
import { PullRequestReviewDialog } from './pull-request-review-dialog'
import { PullRequestSidebarSection } from './pull-request-sidebar-section'

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
	const canRequest = viewer.canRequestReviewers && isOpen

	return (
		<PullRequestSidebarSection
			action={
				canRequest && (
					<PullRequestReviewerRequestPopover
						candidates={reviewerCandidates}
						listedUsernames={entries.map(entry => entry.reviewer.username)}
						number={number}
						slug={slug}
						username={username}
					/>
				)
			}
			title="Reviewers"
		>
			{entries.length === 0 ? (
				<p className="text-muted-foreground text-sm">No reviewers</p>
			) : (
				<ul className="flex flex-col gap-2">
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
			{viewer.allowedOutcomes.length > 0 && (
				<PullRequestReviewDialog
					allowedOutcomes={viewer.allowedOutcomes}
					headSha={headSha}
					isGitHubAuthoritative={isGitHubAuthoritative}
					number={number}
					pendingCommentCount={pendingCommentCount}
					slug={slug}
					triggerLabel="Review changes"
					triggerVariant="outline"
					username={username}
				/>
			)}
		</PullRequestSidebarSection>
	)
}

interface PullRequestReviewerRequestPopoverProps {
	username: string
	slug: string
	number: string
	candidates: readonly PullRequestReviewerCandidate[]
	listedUsernames: readonly string[]
}

/**
 * The request form, tucked behind the section's own affordance: asking for a
 * review is an occasional act, and a permanent input beside the reviewers reads
 * as part of the list rather than an action on it.
 */
function PullRequestReviewerRequestPopover({
	...form
}: Readonly<PullRequestReviewerRequestPopoverProps>) {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<Popover onOpenChange={setIsOpen} open={isOpen}>
			<PopoverTrigger
				aria-label="Manage reviewers"
				className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<Settings aria-hidden className="size-3.5" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-3">
				<PullRequestRequestReviewerForm {...form} />
			</PopoverContent>
		</Popover>
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
		<li className="flex min-w-0 flex-col gap-1">
			<div className="flex min-w-0 items-center gap-1.5">
				{reviewer.htmlUrl ? (
					<a
						className="flex min-w-0 flex-1 hover:underline"
						href={reviewer.htmlUrl}
						rel="noreferrer"
						target="_blank"
					>
						<PullRequestActorLabel actor={reviewer} className="text-sm" />
					</a>
				) : (
					<PullRequestActorLabel actor={reviewer} className="flex-1 text-sm" />
				)}
				{canRemove && entry.isRequested && (
					<Button
						aria-label={`Remove review request for ${reviewer.username}`}
						className="size-6 shrink-0 text-muted-foreground"
						disabled={isRemoving}
						onClick={onRemove}
						size="icon"
						variant="ghost"
					>
						<X />
					</Button>
				)}
				{/* The verdict is an icon in the row and a word to a screen reader. */}
				<span
					className="inline-flex shrink-0 items-center"
					title={
						reviewedAt
							? `${presentation.label} on ${formatPullRequestDate(reviewedAt)}`
							: presentation.label
					}
				>
					<presentation.icon
						aria-hidden
						className={cn('size-4', presentation.iconClassName)}
					/>
					<span className="sr-only">{presentation.label}</span>
				</span>
			</div>
			{(entry.stale || (entry.outcome && entry.isRequested)) && (
				<span className="flex flex-wrap items-center gap-1.5">
					{entry.stale && (
						<span
							className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-400 text-xs"
							title="This review predates the current changes."
						>
							<History aria-hidden className="size-3" />
							Stale
						</span>
					)}
					{entry.outcome && entry.isRequested && (
						<span className="inline-flex items-center rounded-full border border-border px-1.5 py-0.5 text-muted-foreground text-xs">
							Re-requested
						</span>
					)}
				</span>
			)}
			{entry.reviewId && (
				<Link
					aria-label={`View changes since ${reviewer.username} reviewed`}
					className="inline-flex w-fit items-center gap-1 text-[0.6875rem] text-muted-foreground hover:underline"
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
		</li>
	)
}
