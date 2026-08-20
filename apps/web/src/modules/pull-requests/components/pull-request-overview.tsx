import type {
	ChecksSummary,
	MergeQueueStatus,
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
import { getPullRequestReviewContext } from '../helpers/pull-request-review'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestDescriptionComment } from './pull-request-description-comment'
import { PullRequestMergeBox } from './pull-request-merge-box'
import { PullRequestPendingReviewBanner } from './pull-request-pending-review-banner'
import { PullRequestSidebar } from './pull-request-sidebar'
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
	mergeQueue: MergeQueueStatus
	viewerPendingReview?: PullRequestPendingReview
	reviewViewer: PullRequestReviewViewer
	canWrite: boolean
	viewerUserId?: SessionUser['id']
	isFromGitHub: boolean
	isGitHubAuthoritative: boolean
	canReadSyncHealth: boolean
}

/**
 * The conversation: the description as its first comment, everything that has
 * happened since, and the merge box that closes it — with the sidebar beside.
 */
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
	mergeQueue,
	viewerPendingReview,
	reviewViewer,
	canWrite,
	viewerUserId,
	isFromGitHub,
	isGitHubAuthoritative,
	canReadSyncHealth,
}: Readonly<PullRequestOverviewProps>) {
	const number = String(pullRequest.number)
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	// The reviewed head is whichever comparison the viewer is reading, never a
	// freshly resolved one: a review must never cover unseen commits.
	const headSha = threadsQuery.data?.comparison.headSha
	const review = getPullRequestReviewContext(reviewViewer, viewerPendingReview)

	return (
		<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
			<div className="flex min-w-0 flex-1 flex-col gap-4">
				{viewerPendingReview && (
					<PullRequestPendingReviewBanner
						allowedOutcomes={reviewViewer.allowedOutcomes}
						headSha={headSha}
						isGitHubAuthoritative={isGitHubAuthoritative}
						isOpen={pullRequest.state === 'open'}
						number={number}
						pendingReview={viewerPendingReview}
						slug={slug}
						username={username}
					/>
				)}
				<PullRequestTimeline
					canReadSyncHealth={canReadSyncHealth}
					events={events}
					isFromGitHub={isFromGitHub}
					isGitHubAuthoritative={isGitHubAuthoritative}
					leading={
						<PullRequestDescriptionComment
							author={findPullRequestAuthor(events)}
							canWrite={canWrite}
							pullRequest={pullRequest}
							slug={slug}
							username={username}
						/>
					}
					number={number}
					review={review}
					reviews={reviews}
					slug={slug}
					trailing={
						<PullRequestMergeBox
							canWrite={canWrite}
							checksSummary={checksSummary}
							isGitHubAuthoritative={isGitHubAuthoritative}
							mergeQueue={mergeQueue}
							pullRequest={pullRequest}
							slug={slug}
							username={username}
						/>
					}
					username={username}
					viewerUserId={viewerUserId}
				/>
			</div>
			<PullRequestSidebar
				effectiveReviewStates={effectiveReviewStates}
				headSha={headSha}
				isGitHubAuthoritative={isGitHubAuthoritative}
				pendingCommentCount={viewerPendingReview?.commentCount}
				pullRequest={pullRequest}
				reviewerCandidates={reviewerCandidates}
				reviewerRequests={reviewerRequests}
				reviewViewer={reviewViewer}
				slug={slug}
				username={username}
			/>
		</div>
	)
}

/** The identity the opening event kept, which carries an avatar and a profile. */
function findPullRequestAuthor(events: readonly PullRequestEvent[]) {
	return events.find(event => event.type === 'opened')?.actor
}
