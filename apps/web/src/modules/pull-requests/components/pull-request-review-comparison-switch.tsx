import type {
	PullRequestReview,
	PullRequestReviewComparison,
	PullRequestReviewId,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { cn } from '@repo/ui/utils'
import {
	formatPullRequestDate,
	formatPullRequestShortSha,
	getPullRequestActorName,
} from '../helpers/pull-request-formatting'
import {
	getDefaultPullRequestReviewId,
	getPullRequestReviewLabel,
} from '../helpers/pull-request-review'

const SEGMENT_CLASSES =
	'h-6 rounded-sm px-2.5 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground'
const SEGMENT_ON_CLASSES = 'bg-background text-foreground shadow-xs'

interface PullRequestReviewComparisonSwitchProps {
	reviews: readonly PullRequestReview[]
	selectedReviewId?: PullRequestReviewId
	viewerUserId?: SessionUser['id']
	onSelectedReviewIdChange: (reviewId?: PullRequestReviewId) => void
}

/** Which comparison is being read, sitting on the toolbar row rather than in a card. */
export function PullRequestReviewComparisonSwitch({
	reviews,
	selectedReviewId,
	viewerUserId,
	onSelectedReviewIdChange,
}: Readonly<PullRequestReviewComparisonSwitchProps>) {
	const defaultReviewId = getDefaultPullRequestReviewId(reviews, viewerUserId)
	const isSinceReview = Boolean(selectedReviewId)

	function handleSelectedReviewChange(reviewId: string | null) {
		const review = reviews.find(entry => entry.id === reviewId)

		if (review) onSelectedReviewIdChange(review.id)
	}

	return (
		<div className="flex min-w-0 items-center gap-2">
			<fieldset className="flex h-7 items-center rounded-md bg-secondary p-0.5">
				<legend className="sr-only">Choose which changes to show</legend>
				<Button
					aria-pressed={!isSinceReview}
					className={cn(SEGMENT_CLASSES, !isSinceReview && SEGMENT_ON_CLASSES)}
					onClick={() => onSelectedReviewIdChange(undefined)}
					variant="ghost"
				>
					Full diff
				</Button>
				<Button
					aria-pressed={isSinceReview}
					className={cn(SEGMENT_CLASSES, isSinceReview && SEGMENT_ON_CLASSES)}
					disabled={!defaultReviewId}
					onClick={() =>
						onSelectedReviewIdChange(selectedReviewId ?? defaultReviewId)
					}
					variant="ghost"
				>
					Since review
				</Button>
			</fieldset>
			{isSinceReview && reviews.length > 0 && (
				<Select
					onValueChange={handleSelectedReviewChange}
					value={selectedReviewId}
				>
					<SelectTrigger
						aria-label="Review to compare against"
						className="h-7 w-full max-w-96 justify-start text-xs sm:w-64"
					>
						<SelectValue placeholder="Select a review" />
					</SelectTrigger>
					<SelectContent align="start" className="w-96">
						{reviews.map(review => (
							<SelectItem key={review.id} value={review.id}>
								<span className="flex min-w-0 flex-col items-start">
									<span className="truncate">
										{getPullRequestActorName(review.reviewer)} ·{' '}
										{getPullRequestReviewLabel(review)}
									</span>
									<span className="text-muted-foreground text-xs">
										{formatPullRequestDate(review.submittedAt)} ·{' '}
										{formatPullRequestShortSha(review.headSha)}
									</span>
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	)
}

interface PullRequestReviewComparisonStateProps {
	reviewComparison: PullRequestReviewComparison
}

export function PullRequestReviewComparisonState({
	reviewComparison,
}: Readonly<PullRequestReviewComparisonStateProps>) {
	const { currentHeadSha, review } = reviewComparison
	const reviewedAt = formatPullRequestDate(review.submittedAt)

	if (reviewComparison.status === 'nothing_new')
		return (
			<p className="text-muted-foreground text-sm">
				Nothing new since {getPullRequestActorName(review.reviewer)} reviewed on{' '}
				{reviewedAt}. The head is still <ShaLabel sha={currentHeadSha} />.
			</p>
		)

	if (reviewComparison.status === 'review_head_unavailable')
		return (
			<div className="flex flex-col gap-1">
				<p className="text-amber-400 text-sm">
					The commit <ShaLabel sha={review.headSha} /> that{' '}
					{getPullRequestActorName(review.reviewer)} reviewed is no longer in
					this repository, so what changed since cannot be worked out. A
					force-push followed by cleanup removes it.
				</p>
				<p className="text-muted-foreground text-sm">
					The full diff still shows every change up to{' '}
					<ShaLabel sha={currentHeadSha} />.
				</p>
			</div>
		)

	return (
		<div className="flex flex-col gap-1">
			<p className="text-sm">
				Changes since {getPullRequestActorName(review.reviewer)} reviewed on{' '}
				{reviewedAt} — <ShaLabel sha={review.headSha} /> →{' '}
				<ShaLabel sha={currentHeadSha} />
			</p>
			{reviewComparison.historiesDiverged && (
				<p className="text-amber-400 text-sm">
					The reviewed commit is no longer an ancestor of the current head, so
					this starts at the common ancestor{' '}
					<ShaLabel sha={reviewComparison.comparison.mergeBaseSha} />. Changes
					that were already reviewed can reappear here.
				</p>
			)}
		</div>
	)
}

function ShaLabel({ sha }: Readonly<{ sha: string }>) {
	return (
		<code className="rounded bg-muted px-1 py-0.5 text-xs" title={sha}>
			{formatPullRequestShortSha(sha)}
		</code>
	)
}
