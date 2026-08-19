import type {
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewId,
	PullRequestReviewViewer,
	SessionUser,
} from '@repo/contracts'
import type {
	PullRequestReviewContext,
	PullRequestReviewSelection,
} from '../helpers/pull-request-review'
import { usePullRequestReviewComparisonQuery } from '../hooks/use-pull-request-review-comparison.query'
import { PullRequestComparisonFiles } from './pull-request-comparison-files'
import { PullRequestComparisonSkeleton } from './pull-request-comparison-skeleton'
import { PullRequestReviewChangesAction } from './pull-request-review-changes-action'
import {
	PullRequestReviewComparisonState,
	PullRequestReviewComparisonSwitch,
} from './pull-request-review-comparison-switch'
import { PullRequestsMessage } from './pull-requests-message'

interface PullRequestReviewComparisonFilesProps {
	username: string
	slug: string
	number: string
	reviewId: PullRequestReviewId
	reviews: readonly PullRequestReview[]
	onSelectedReviewIdChange: PullRequestReviewSelection['onReviewIdChange']
	review?: PullRequestReviewContext
	reviewViewer: PullRequestReviewViewer
	viewerPendingReview?: PullRequestPendingReview
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
	reviewViewer,
	viewerPendingReview,
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
	const isReady = reviewComparison?.status === 'ready'
	const comparisonSwitch = (
		<PullRequestReviewComparisonSwitch
			onSelectedReviewIdChange={onSelectedReviewIdChange}
			reviews={reviews}
			selectedReviewId={reviewId}
			viewerUserId={viewerUserId}
		/>
	)

	return (
		<div className="flex flex-col gap-3">
			{!isReady && (
				<div className="flex min-h-9 items-center">{comparisonSwitch}</div>
			)}
			{reviewComparison && (
				<PullRequestReviewComparisonState reviewComparison={reviewComparison} />
			)}
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
					toolbarAction={
						<PullRequestReviewChangesAction
							headSha={reviewComparison.currentHeadSha}
							isGitHubAuthoritative={isGitHubAuthoritative}
							number={number}
							slug={slug}
							username={username}
							viewer={reviewViewer}
							viewerPendingReview={viewerPendingReview}
						/>
					}
					toolbarLead={comparisonSwitch}
					username={username}
					viewerUserId={viewerUserId}
				/>
			)}
		</div>
	)
}
