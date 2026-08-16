import type {
	PullRequestReview,
	PullRequestReviewId,
	SessionUser,
} from '@repo/contracts'
import type {
	PullRequestReviewContext,
	PullRequestReviewSelection,
} from '../helpers/pull-request-review'
import { usePullRequestReviewComparisonQuery } from '../hooks/use-pull-request-review-comparison.query'
import { PullRequestComparisonFiles } from './pull-request-comparison-files'
import { PullRequestComparisonSkeleton } from './pull-request-comparison-skeleton'
import { PullRequestReviewComparisonBanner } from './pull-request-review-comparison-banner'
import { PullRequestsMessage } from './pull-requests-message'

interface PullRequestReviewComparisonFilesProps {
	username: string
	slug: string
	number: string
	reviewId: PullRequestReviewId
	reviews: readonly PullRequestReview[]
	onSelectedReviewIdChange: PullRequestReviewSelection['onReviewIdChange']
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
	isGitHubAuthoritative: boolean
}

/**
 * The files that changed since a review. The switch back to the full diff stays
 * rendered through every state, because the states that show no files are
 * exactly the ones a reader needs it from.
 */
export function PullRequestReviewComparisonFiles({
	username,
	slug,
	number,
	reviewId,
	reviews,
	onSelectedReviewIdChange,
	review,
	viewerUserId,
	isGitHubAuthoritative,
}: Readonly<PullRequestReviewComparisonFilesProps>) {
	const reviewComparisonQuery = usePullRequestReviewComparisonQuery({
		username,
		slug,
		number,
		reviewId,
	})
	const reviewComparison = reviewComparisonQuery.data

	return (
		<div className="flex flex-col gap-3">
			<PullRequestReviewComparisonBanner
				onSelectedReviewIdChange={onSelectedReviewIdChange}
				reviewComparison={reviewComparison}
				reviews={reviews}
				selectedReviewId={reviewId}
				viewerUserId={viewerUserId}
			/>
			{reviewComparisonQuery.isLoading && <PullRequestComparisonSkeleton />}
			{reviewComparisonQuery.isError && (
				<PullRequestsMessage
					description="The changes since this review could not be loaded."
					title="Comparison unavailable"
				/>
			)}
			{reviewComparison?.status === 'ready' && (
				<PullRequestComparisonFiles
					anchorComparison={{
						baseSha: reviewComparison.canonicalBaseSha,
						headSha: reviewComparison.currentHeadSha,
					}}
					comparison={reviewComparison.comparison}
					isGitHubAuthoritative={isGitHubAuthoritative}
					isSinceReview
					// Nothing about an expanded file survives a change of pair: the paths,
					// and the diff behind them, belong to the comparison being shown.
					key={`${reviewComparison.review.headSha}:${reviewComparison.currentHeadSha}`}
					number={number}
					review={review}
					slug={slug}
					username={username}
					viewerUserId={viewerUserId}
				/>
			)}
		</div>
	)
}
