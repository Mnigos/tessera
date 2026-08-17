import type {
	PullRequestPendingReview,
	PullRequestReviewViewer,
} from '@repo/contracts'
import { PullRequestReviewDialog } from './pull-request-review-dialog'

interface PullRequestReviewChangesActionProps {
	username: string
	slug: string
	number: string
	viewer: PullRequestReviewViewer
	/** The comparison on screen, which is the one the review is recorded against. */
	headSha: string
	viewerPendingReview?: PullRequestPendingReview
	isGitHubAuthoritative: boolean
}

export function PullRequestReviewChangesAction({
	username,
	slug,
	number,
	viewer,
	headSha,
	viewerPendingReview,
	isGitHubAuthoritative,
}: Readonly<PullRequestReviewChangesActionProps>) {
	if (viewer.allowedOutcomes.length === 0) return null

	return (
		<PullRequestReviewDialog
			allowedOutcomes={viewer.allowedOutcomes}
			headSha={headSha}
			isGitHubAuthoritative={isGitHubAuthoritative}
			number={number}
			pendingCommentCount={viewerPendingReview?.commentCount}
			slug={slug}
			triggerLabel="Review changes"
			username={username}
		/>
	)
}
