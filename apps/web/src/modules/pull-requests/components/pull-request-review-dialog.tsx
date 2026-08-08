import type { PullRequestReviewOutcome } from '@repo/contracts'
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
import { cn } from '@repo/ui/utils'
import { type ComponentProps, useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import {
	getPullRequestReviewOutcomePresentation,
	PULL_REQUEST_REVIEW_OUTCOME_OPTIONS,
} from '../helpers/pull-request-review'
import { useSubmitPullRequestReviewMutation } from '../hooks/use-submit-pull-request-review.mutation'

const REVIEW_BODY_INPUT_ID = 'pull-request-review-body'

interface PullRequestReviewDialogProps {
	username: string
	slug: string
	number: string
	headSha?: string
	pendingCommentCount?: number
	triggerLabel: string
	triggerVariant?: ComponentProps<typeof Button>['variant']
}

export function PullRequestReviewDialog({
	username,
	slug,
	number,
	headSha,
	pendingCommentCount,
	triggerLabel,
	triggerVariant,
}: Readonly<PullRequestReviewDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	// The review covers the comparison that was on screen when the dialog opened.
	// Holding it here keeps a background refetch from moving the head under an
	// approval the viewer never read.
	const [reviewedHeadSha, setReviewedHeadSha] = useState<string>()
	const submitReview = useSubmitPullRequestReviewMutation()

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
			<DialogTrigger
				disabled={!headSha}
				render={<Button size="sm" variant={triggerVariant} />}
				title={
					headSha ? undefined : 'The comparison for this review is unavailable.'
				}
			>
				{triggerLabel}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Review changes</DialogTitle>
					<DialogDescription>
						{pendingCommentCount
							? `Submitting publishes ${pendingCommentCount} pending ${pendingCommentCount === 1 ? 'comment' : 'comments'} against the changes you are viewing.`
							: 'Your review is recorded against the changes you are viewing and goes stale if the branch moves.'}
					</DialogDescription>
				</DialogHeader>
				<PullRequestReviewForm
					errorMessage={
						submitReview.isError
							? getPullRequestErrorMessage(
									submitReview.error,
									'The review could not be submitted.'
								)
							: undefined
					}
					isPending={submitReview.isPending}
					onSubmit={handleSubmit}
				/>
			</DialogContent>
		</Dialog>
	)
}

interface PullRequestReviewFormProps {
	errorMessage?: string
	isPending: boolean
	onSubmit: (outcome: PullRequestReviewOutcome, body: string) => void
}

function PullRequestReviewForm({
	errorMessage,
	isPending,
	onSubmit,
}: Readonly<PullRequestReviewFormProps>) {
	const [outcome, setOutcome] = useState<PullRequestReviewOutcome>('comment')
	const [body, setBody] = useState('')

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		if (isPending) return

		onSubmit(outcome, body.trim())
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

					return (
						<label
							className={cn(
								'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
								isSelected
									? presentation.cardClassName
									: 'border-border hover:bg-muted/40'
							)}
							key={option.value}
						>
							<input
								checked={isSelected}
								className="mt-1 accent-primary"
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
					)
				})}
			</fieldset>
			<div className="flex flex-col gap-2">
				<Label className="sr-only" htmlFor={REVIEW_BODY_INPUT_ID}>
					Review summary
				</Label>
				<textarea
					className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					id={REVIEW_BODY_INPUT_ID}
					maxLength={65_536}
					onChange={event => setBody(event.target.value)}
					placeholder="Leave a summary (optional)"
					value={body}
				/>
			</div>
			{errorMessage && (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			)}
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="secondary" />}>
					Cancel
				</DialogClose>
				<Button disabled={isPending} type="submit">
					{isPending ? 'Submitting' : 'Submit review'}
				</Button>
			</DialogFooter>
		</form>
	)
}
