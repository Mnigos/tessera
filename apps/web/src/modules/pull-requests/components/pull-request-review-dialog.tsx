import {
	GITHUB_WRITE_REJECTED_MESSAGES,
	type PullRequestReviewOutcome,
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
import { type ComponentProps, useState } from 'react'
import { isGitHubSyncDelayedError } from '../helpers/get-pull-request-error-message'
import { submitPullRequestComposerOnShortcut } from '../helpers/pull-request-composer-shortcut'
import {
	getPullRequestReviewOutcomePresentation,
	PULL_REQUEST_REVIEW_OUTCOME_OPTIONS,
} from '../helpers/pull-request-review'
import { useSubmitPullRequestReviewMutation } from '../hooks/use-submit-pull-request-review.mutation'
import { PullRequestErrorMessage } from './pull-request-error-message'

const REVIEW_BODY_INPUT_ID = 'pull-request-review-body'
const REVIEW_BODY_HINT_ID = 'pull-request-review-body-hint'
const REVIEW_OUTCOME_HINT_ID = 'pull-request-review-outcome-hint'
// Only the pull request author is ever left a subset of the outcomes.
const REVIEW_OUTCOME_REFUSED_REASON =
	'You can comment on your own pull request, but not approve or block it.'

interface PullRequestReviewDialogProps {
	username: string
	slug: string
	number: string
	allowedOutcomes: readonly PullRequestReviewOutcome[]
	headSha?: string
	pendingCommentCount?: number
	/** Left unset on surfaces a mirrored pull request never reaches. */
	isGitHubAuthoritative?: boolean
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
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Review changes</DialogTitle>
					<DialogDescription>
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
					onSubmit={handleSubmit}
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
}

function PullRequestReviewForm({
	allowedOutcomes,
	error,
	isBodyRequired,
	isPending,
	onSubmit,
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
										'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
										isAllowed
											? 'cursor-pointer'
											: 'cursor-not-allowed border-border opacity-50',
										isAllowed &&
											(isSelected
												? presentation.cardClassName
												: 'border-border hover:bg-muted/40')
									)}
								>
									<input
										aria-describedby={
											isAllowed ? undefined : REVIEW_OUTCOME_HINT_ID
										}
										checked={isSelected}
										className="mt-1 accent-primary"
										disabled={!isAllowed}
										name="pull-request-review-outcome"
										onChange={() => setOutcome(option.value)}
										type="radio"
										value={option.value}
									/>
									<span className="flex min-w-0 flex-col gap-0.5">
										<span className="flex items-center gap-2 font-medium text-sm">
											<presentation.icon
												aria-hidden
												className={cn('size-4', presentation.iconClassName)}
											/>
											{option.label}
										</span>
										<span className="text-muted-foreground text-xs">
											{option.description}
										</span>
									</span>
								</label>
							</TooltipTrigger>
							{!isAllowed && (
								<TooltipContent>{REVIEW_OUTCOME_REFUSED_REASON}</TooltipContent>
							)}
						</Tooltip>
					)
				})}
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
				<textarea
					aria-describedby={isBodyMissing ? REVIEW_BODY_HINT_ID : undefined}
					className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					id={REVIEW_BODY_INPUT_ID}
					maxLength={65_536}
					onChange={event => setBody(event.target.value)}
					onKeyDown={submitPullRequestComposerOnShortcut}
					placeholder={
						isBodyRequired ? 'Leave a summary' : 'Leave a summary (optional)'
					}
					value={body}
				/>
				{isBodyMissing && (
					<p className="text-muted-foreground text-xs" id={REVIEW_BODY_HINT_ID}>
						{GITHUB_WRITE_REJECTED_MESSAGES.review_body_required}
					</p>
				)}
			</div>
			{Boolean(error) && (
				<PullRequestErrorMessage
					error={error}
					fallback="The review could not be submitted."
				/>
			)}
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="secondary" />}>
					Cancel
				</DialogClose>
				<Button disabled={isSpent} type="submit">
					{isPending ? 'Submitting' : 'Submit review'}
				</Button>
			</DialogFooter>
		</form>
	)
}
