import type {
	PullRequestReview,
	PullRequestReviewComparison,
	PullRequestReviewId,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import {
	formatPullRequestDate,
	formatPullRequestShortSha,
} from '../helpers/pull-request-formatting'
import {
	getDefaultPullRequestReviewId,
	getPullRequestReviewLabel,
} from '../helpers/pull-request-review'

interface PullRequestReviewComparisonBannerProps {
	reviews: readonly PullRequestReview[]
	selectedReviewId?: PullRequestReviewId
	/** Absent while the selected comparison loads, and in full-diff mode. */
	reviewComparison?: PullRequestReviewComparison
	viewerUserId?: SessionUser['id']
	onSelectedReviewIdChange: (reviewId?: PullRequestReviewId) => void
}

export function PullRequestReviewComparisonBanner({
	reviews,
	selectedReviewId,
	reviewComparison,
	viewerUserId,
	onSelectedReviewIdChange,
}: Readonly<PullRequestReviewComparisonBannerProps>) {
	const defaultReviewId = getDefaultPullRequestReviewId(reviews, viewerUserId)
	const isSinceReview = Boolean(selectedReviewId)

	function handleSelectedReviewChange(reviewId: string | null) {
		const review = reviews.find(entry => entry.id === reviewId)

		if (review) onSelectedReviewIdChange(review.id)
	}

	return (
		<Card className="gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<fieldset
					aria-label="Choose which changes to show"
					className="flex flex-wrap items-center gap-1"
				>
					<Button
						aria-pressed={!isSinceReview}
						onClick={() => onSelectedReviewIdChange(undefined)}
						size="sm"
						variant={isSinceReview ? 'ghost' : 'secondary'}
					>
						Full diff
					</Button>
					<Button
						aria-pressed={isSinceReview}
						disabled={!defaultReviewId}
						onClick={() =>
							onSelectedReviewIdChange(selectedReviewId ?? defaultReviewId)
						}
						size="sm"
						variant={isSinceReview ? 'secondary' : 'ghost'}
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
							className="w-full max-w-96 justify-start sm:w-80"
						>
							<SelectValue placeholder="Select a review" />
						</SelectTrigger>
						<SelectContent align="start" className="w-96">
							{reviews.map(review => (
								<SelectItem key={review.id} value={review.id}>
									<span className="flex min-w-0 flex-col items-start">
										<span className="truncate">
											{review.reviewer.username} ·{' '}
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
			{reviewComparison && (
				<PullRequestReviewComparisonState reviewComparison={reviewComparison} />
			)}
		</Card>
	)
}

interface PullRequestReviewComparisonStateProps {
	reviewComparison: PullRequestReviewComparison
}

function PullRequestReviewComparisonState({
	reviewComparison,
}: Readonly<PullRequestReviewComparisonStateProps>) {
	const { currentHeadSha, review } = reviewComparison
	const reviewedAt = formatPullRequestDate(review.submittedAt)

	if (reviewComparison.status === 'nothing_new')
		return (
			<p className="text-muted-foreground text-sm">
				Nothing new since {review.reviewer.username} reviewed on {reviewedAt}.
				The head is still <ShaLabel sha={currentHeadSha} />.
			</p>
		)

	if (reviewComparison.status === 'review_head_unavailable')
		return (
			<div className="flex flex-col gap-1">
				<p className="text-amber-400 text-sm">
					The commit <ShaLabel sha={review.headSha} /> that{' '}
					{review.reviewer.username} reviewed is no longer in this repository,
					so what changed since cannot be worked out. A force-push followed by
					cleanup removes it.
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
				Changes since {review.reviewer.username} reviewed on {reviewedAt} —{' '}
				<ShaLabel sha={review.headSha} /> → <ShaLabel sha={currentHeadSha} />
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
