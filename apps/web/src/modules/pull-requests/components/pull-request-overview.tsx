import type {
	ChecksSummary,
	PullRequest,
	PullRequestEffectiveReviewState,
	PullRequestEvent,
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewerCandidate,
	PullRequestReviewerRequest,
	PullRequestReviewViewer,
	SessionUser,
} from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { MarkdownContent } from '@/shared/components/markdown-content'
import type { PullRequestReviewContext } from '../helpers/pull-request-review'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestChecksPanel } from './pull-request-checks-panel'
import { PullRequestMergePanel } from './pull-request-merge-panel'
import { PullRequestPendingReviewBanner } from './pull-request-pending-review-banner'
import { PullRequestReviewersPanel } from './pull-request-reviewers-panel'
import { PullRequestTimeline } from './pull-request-timeline'

interface PullRequestOverviewProps {
	username: string
	slug: string
	pullRequest: PullRequest
	events: PullRequestEvent[]
	reviewerRequests: PullRequestReviewerRequest[]
	reviews: PullRequestReview[]
	effectiveReviewStates: PullRequestEffectiveReviewState[]
	reviewerCandidates: PullRequestReviewerCandidate[]
	checksSummary?: ChecksSummary
	viewerPendingReview?: PullRequestPendingReview
	reviewViewer: PullRequestReviewViewer
	canWrite: boolean
	viewerUserId?: SessionUser['id']
}

export function PullRequestOverview({
	username,
	slug,
	pullRequest,
	events,
	reviewerRequests,
	reviews,
	effectiveReviewStates,
	reviewerCandidates,
	checksSummary,
	viewerPendingReview,
	reviewViewer,
	canWrite,
	viewerUserId,
}: Readonly<PullRequestOverviewProps>) {
	const number = String(pullRequest.number)
	const isOpen = pullRequest.state === 'open'
	const comparisonQuery = usePullRequestComparisonQuery(
		{ username, slug, number },
		canWrite && isOpen
	)
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	// The reviewed head is whichever comparison the viewer is reading, never a
	// freshly resolved one: a review must never cover unseen commits.
	const headSha = threadsQuery.data?.comparison.headSha
	const review: PullRequestReviewContext = {
		canSubmitReview: reviewViewer.canSubmitReview,
		hasPendingReview: Boolean(viewerPendingReview),
	}
	const hasReviewers =
		reviewerRequests.length > 0 ||
		effectiveReviewStates.length > 0 ||
		reviewViewer.canRequestReviewers ||
		reviewViewer.canSubmitReview

	return (
		<div
			className={cn(
				'flex flex-col gap-6',
				hasReviewers &&
					'lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8'
			)}
		>
			<div className="flex min-w-0 flex-col gap-6">
				<Card className="gap-2">
					<h2 className="font-semibold text-base tracking-normal">
						Description
					</h2>
					{pullRequest.body ? (
						<MarkdownContent>{pullRequest.body}</MarkdownContent>
					) : (
						<p className="text-muted-foreground text-sm italic">
							No description provided.
						</p>
					)}
				</Card>
				<PullRequestChecksPanel
					checksSummary={checksSummary}
					number={number}
					slug={slug}
					username={username}
				/>
				{canWrite && (
					<PullRequestMergePanel
						comparison={comparisonQuery.data}
						isComparisonError={comparisonQuery.isError}
						isComparisonLoading={comparisonQuery.isLoading}
						onRefreshComparison={() => comparisonQuery.refetch()}
						pullRequest={pullRequest}
						slug={slug}
						username={username}
					/>
				)}
				{viewerPendingReview && (
					<PullRequestPendingReviewBanner
						canSubmitReview={reviewViewer.canSubmitReview}
						headSha={headSha}
						isOpen={isOpen}
						number={number}
						pendingReview={viewerPendingReview}
						slug={slug}
						username={username}
					/>
				)}
				<PullRequestTimeline
					events={events}
					number={number}
					review={review}
					reviews={reviews}
					slug={slug}
					username={username}
					viewerUserId={viewerUserId}
				/>
			</div>
			{hasReviewers && (
				<aside className="flex flex-col gap-4 lg:sticky lg:top-6">
					<PullRequestReviewersPanel
						effectiveReviewStates={effectiveReviewStates}
						headSha={headSha}
						isOpen={isOpen}
						number={number}
						pendingCommentCount={viewerPendingReview?.commentCount}
						reviewerCandidates={reviewerCandidates}
						reviewerRequests={reviewerRequests}
						slug={slug}
						username={username}
						viewer={reviewViewer}
					/>
				</aside>
			)}
		</div>
	)
}
