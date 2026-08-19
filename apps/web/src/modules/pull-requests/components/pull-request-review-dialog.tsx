import {
	GITHUB_WRITE_REJECTED_MESSAGES,
	type PullRequestReviewOutcome,
	type PullRequestThread,
} from '@repo/contracts'
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@repo/ui/components/tooltip'
import { cn } from '@repo/ui/utils'
import { CornerDownRight } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { isGitHubSyncDelayedError } from '../helpers/get-pull-request-error-message'
import {
	getPullRequestReviewOutcomePresentation,
	PULL_REQUEST_REVIEW_OUTCOME_OPTIONS,
} from '../helpers/pull-request-review'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { useSubmitPullRequestReviewMutation } from '../hooks/use-submit-pull-request-review.mutation'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestMarkdownField } from './pull-request-markdown-editor'

const REVIEW_BODY_INPUT_ID = 'pull-request-review-body'
const REVIEW_BODY_HINT_ID = 'pull-request-review-body-hint'
const REVIEW_OUTCOME_HINT_ID = 'pull-request-review-outcome-hint'
// Only the pull request author is ever left a subset of the outcomes.
const REVIEW_OUTCOME_REFUSED_REASON =
	'You can comment on your own pull request, but not approve or block it.'
// Beyond a handful the list would push the summary and the submit off screen.
const COLLAPSED_PENDING_COMMENT_COUNT = 5
const SELECTED_REVIEW_OUTCOME_CLASSES: Record<
	PullRequestReviewOutcome,
	string
> = {
	approve: 'border-emerald-500/40 bg-emerald-500/10',
	request_changes: 'border-rose-500/40 bg-rose-500/10',
	comment: 'border-border bg-secondary',
}

interface PullRequestPendingComment {
	id: string
	path?: string
	location: string
	excerpt: string
}

// Every pending comment is the viewer's own: drafts reach nobody else.
function getPullRequestPendingComments(
	threads: readonly PullRequestThread[] | undefined
): PullRequestPendingComment[] {
	return (threads ?? []).flatMap(thread =>
		thread.comments
			.filter(comment => comment.state === 'pending')
			.map(comment => ({
				id: comment.id,
				path: thread.anchor?.path,
				location: thread.anchor
					? `${thread.anchor.path}:${thread.anchor.endLine}`
					: 'Conversation',
				excerpt: comment.body.trim().split('\n')[0] ?? '',
			}))
	)
}

interface PullRequestReviewDialogProps {
	username: string
	slug: string
	number: string
	allowedOutcomes: readonly PullRequestReviewOutcome[]
	headSha?: string
	pendingCommentCount?: number
	/** Left unset on surfaces a mirrored pull request never reaches. */
	isGitHubAuthoritative?: boolean
	/** Scrolls the files view to a draft's file; absent where there is none. */
	onJumpToComment?: (path: string) => void
	triggerLabel: string
	triggerVariant?: ComponentProps<typeof Button>['variant']
}

export function PullRequestReviewDialog({
	username,
	slug,
	number,
	allowedOutcomes,
	headSha,
	pendingCommentCount,
	isGitHubAuthoritative = false,
	onJumpToComment,
	triggerLabel,
	triggerVariant,
}: Readonly<PullRequestReviewDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	// The review covers the comparison that was on screen when the dialog opened.
	// Holding it here keeps a background refetch from moving the head under an
	// approval the viewer never read.
	const [reviewedHeadSha, setReviewedHeadSha] = useState<string>()
	const submitReview = useSubmitPullRequestReviewMutation()
	// A draft left from before the mirror is not part of a GitHub review.
	const batchedCommentCount = isGitHubAuthoritative
		? undefined
		: pendingCommentCount
	// The files view has already fetched these; the dialog reads the same cache.
	const threadsQuery = usePullRequestThreadsQuery(
		{ username, slug, number },
		isOpen && Boolean(batchedCommentCount)
	)
	const pendingComments = batchedCommentCount
		? getPullRequestPendingComments(threadsQuery.data?.threads)
		: []

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (open) setReviewedHeadSha(headSha)
		else submitReview.reset()
	}

	function handleSubmit(outcome: PullRequestReviewOutcome, body: string) {
		if (!reviewedHeadSha) return

		submitReview.mutate(
			{
				username,
				slug,
				number,
				outcome,
				body: body || undefined,
				expectedHeadSha: reviewedHeadSha,
			},
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	function handleJumpToComment(path: string) {
		setIsOpen(false)
		onJumpToComment?.(path)
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<div className="flex flex-col items-start gap-1">
				<DialogTrigger
					disabled={!headSha}
					render={<Button size="sm" variant={triggerVariant} />}
				>
					{triggerLabel}
				</DialogTrigger>
				{!headSha && (
					<p className="text-muted-foreground text-xs">
						The comparison for this review is unavailable.
					</p>
				)}
			</div>
			<DialogContent className="sm:max-w-[35rem]">
				<DialogHeader>
					<DialogTitle>Review changes</DialogTitle>
					<DialogDescription>
						{reviewedHeadSha && (
							<span className="font-mono">
								{reviewedHeadSha.slice(0, 7)} ·{' '}
							</span>
						)}
						{batchedCommentCount
							? `Submitting publishes ${batchedCommentCount} pending ${batchedCommentCount === 1 ? 'comment' : 'comments'} against the changes you are viewing.`
							: 'Your review is recorded against the changes you are viewing and goes stale if the branch moves.'}
					</DialogDescription>
				</DialogHeader>
				<PullRequestReviewForm
					allowedOutcomes={allowedOutcomes}
					error={submitReview.error}
					isBodyRequired={isGitHubAuthoritative && !pendingCommentCount}
					isPending={submitReview.isPending}
					onJumpToComment={onJumpToComment && handleJumpToComment}
					onSubmit={handleSubmit}
					pendingComments={pendingComments}
				/>
			</DialogContent>
		</Dialog>
	)
}

interface PullRequestReviewFormProps {
	allowedOutcomes: readonly PullRequestReviewOutcome[]
	error: unknown
	/** GitHub takes no bodyless review other than an approval that carries no comments. */
	isBodyRequired: boolean
	isPending: boolean
	onSubmit: (outcome: PullRequestReviewOutcome, body: string) => void
	pendingComments: readonly PullRequestPendingComment[]
	onJumpToComment?: (path: string) => void
}

function PullRequestReviewForm({
	allowedOutcomes,
	error,
	isBodyRequired,
	isPending,
	onSubmit,
	pendingComments,
	onJumpToComment,
}: Readonly<PullRequestReviewFormProps>) {
	const [outcome, setOutcome] = useState<PullRequestReviewOutcome>('comment')
	const [body, setBody] = useState('')
	const [sent, setSent] = useState<`${PullRequestReviewOutcome}:${string}`>()
	const trimmedBody = body.trim()
	const isBodyMissing =
		isBodyRequired && outcome !== 'approve' && trimmedBody.length === 0
	const hasRefusedOutcome = PULL_REQUEST_REVIEW_OUTCOME_OPTIONS.some(
		option => !allowedOutcomes.includes(option.value)
	)
	const selectedOption = PULL_REQUEST_REVIEW_OUTCOME_OPTIONS.find(
		option => option.value === outcome
	)
	// Resubmitting this exact review would leave a second one GitHub already has.
	const isSpent =
		isPending ||
		isBodyMissing ||
		(isGitHubSyncDelayedError(error) && `${outcome}:${trimmedBody}` === sent)

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		if (isSpent) return

		setSent(`${outcome}:${trimmedBody}`)
		onSubmit(outcome, trimmedBody)
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<fieldset className="flex flex-col gap-2">
				<legend className="sr-only">Review outcome</legend>
				<div className="grid grid-cols-3 gap-2">
					{PULL_REQUEST_REVIEW_OUTCOME_OPTIONS.map(option => {
						const presentation = getPullRequestReviewOutcomePresentation(
							option.value
						)
						const isSelected = outcome === option.value
						const isAllowed = allowedOutcomes.includes(option.value)

						return (
							<Tooltip key={option.value}>
								{/* A disabled radio takes no focus, so the reason hangs off the wrapper. */}
								<TooltipTrigger
									render={
										<span
											className="flex flex-col"
											tabIndex={isAllowed ? undefined : 0}
										/>
									}
								>
									<label
										className={cn(
											'flex h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-center font-medium text-sm transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/55',
											isAllowed
												? 'cursor-pointer'
												: 'cursor-not-allowed border-border opacity-50',
											isAllowed &&
												(isSelected
													? SELECTED_REVIEW_OUTCOME_CLASSES[option.value]
													: 'border-border hover:bg-muted/40')
										)}
									>
										<input
											aria-describedby={
												isAllowed ? undefined : REVIEW_OUTCOME_HINT_ID
											}
											checked={isSelected}
											className="sr-only"
											disabled={!isAllowed}
											name="pull-request-review-outcome"
											onChange={() => setOutcome(option.value)}
											type="radio"
											value={option.value}
										/>
										<presentation.icon
											aria-hidden
											className={cn(
												'size-4 shrink-0',
												presentation.iconClassName
											)}
										/>
										<span className="truncate">{option.label}</span>
									</label>
								</TooltipTrigger>
								{!isAllowed && (
									<TooltipContent>
										{REVIEW_OUTCOME_REFUSED_REASON}
									</TooltipContent>
								)}
							</Tooltip>
						)
					})}
				</div>
				{selectedOption && (
					<p className="text-muted-foreground text-xs">
						{selectedOption.description}
					</p>
				)}
				{hasRefusedOutcome && (
					<p
						className="text-muted-foreground text-xs"
						id={REVIEW_OUTCOME_HINT_ID}
					>
						{REVIEW_OUTCOME_REFUSED_REASON}
					</p>
				)}
			</fieldset>
			<div className="flex flex-col gap-2">
				<Label className="sr-only" htmlFor={REVIEW_BODY_INPUT_ID}>
					Review summary
				</Label>
				<PullRequestMarkdownField
					id={REVIEW_BODY_INPUT_ID}
					modeLabel="Review summary mode"
					onValueChange={setBody}
					placeholder={
						isBodyRequired ? 'Leave a summary' : 'Leave a summary (optional)'
					}
					textareaClassName="min-h-24"
					value={body}
				/>
				{isBodyMissing && (
					<p className="text-muted-foreground text-xs" id={REVIEW_BODY_HINT_ID}>
						{GITHUB_WRITE_REJECTED_MESSAGES.review_body_required}
					</p>
				)}
			</div>
			{pendingComments.length > 0 && (
				<PullRequestPendingCommentList
					comments={pendingComments}
					onJumpToComment={onJumpToComment}
				/>
			)}
			{Boolean(error) && (
				<PullRequestErrorMessage
					error={error}
					fallback="The review could not be submitted."
				/>
			)}
			<DialogFooter className="sm:items-center sm:justify-between">
				<span className="hidden text-muted-foreground text-xs sm:block">
					⌘⏎ to submit
				</span>
				<div className="flex flex-col-reverse gap-2 sm:flex-row">
					<DialogClose render={<Button type="button" variant="ghost" />}>
						Cancel
					</DialogClose>
					<Button disabled={isSpent} type="submit">
						{isPending ? 'Submitting' : 'Submit review'}
					</Button>
				</div>
			</DialogFooter>
		</form>
	)
}

interface PullRequestPendingCommentListProps {
	comments: readonly PullRequestPendingComment[]
	onJumpToComment?: (path: string) => void
}

// What the viewer is about to publish, re-readable before they publish it.
function PullRequestPendingCommentList({
	comments,
	onJumpToComment,
}: Readonly<PullRequestPendingCommentListProps>) {
	return (
		<details
			className="rounded-md border border-border"
			open={comments.length <= COLLAPSED_PENDING_COMMENT_COUNT}
		>
			<summary className="cursor-pointer px-3 py-2 font-medium text-sm">
				{comments.length} pending{' '}
				{comments.length === 1 ? 'comment' : 'comments'}
			</summary>
			<ul className="max-h-48 overflow-y-auto border-border border-t">
				{comments.map(comment => (
					<li
						className="flex h-8 items-center gap-2 px-3 text-xs"
						key={comment.id}
					>
						<span className="shrink-0 truncate font-mono text-muted-foreground">
							{comment.location}
						</span>
						<span className="min-w-0 flex-1 truncate">{comment.excerpt}</span>
						{onJumpToComment && comment.path && (
							<Button
								aria-label={`Jump to ${comment.location}`}
								className="size-6 shrink-0 text-muted-foreground"
								onClick={() => onJumpToComment(comment.path ?? '')}
								size="icon"
								type="button"
								variant="ghost"
							>
								<CornerDownRight aria-hidden className="size-3.5" />
							</Button>
						)}
					</li>
				))}
			</ul>
		</details>
	)
}
