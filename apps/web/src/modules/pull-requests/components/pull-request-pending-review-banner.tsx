import type {
	PullRequestPendingReview,
	PullRequestReviewOutcome,
} from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { EyeOff } from 'lucide-react'
import { PullRequestDiscardReviewDialog } from './pull-request-discard-review-dialog'
import { PullRequestReviewDialog } from './pull-request-review-dialog'

interface PullRequestPendingReviewBannerProps {
	username: string
	slug: string
	number: string
	pendingReview: PullRequestPendingReview
	headSha?: string
	allowedOutcomes: readonly PullRequestReviewOutcome[]
	isOpen: boolean
}

export function PullRequestPendingReviewBanner({
	username,
	slug,
	number,
	pendingReview,
	headSha,
	allowedOutcomes,
	isOpen,
}: Readonly<PullRequestPendingReviewBannerProps>) {
	const { commentCount } = pendingReview
	const hasMovedHead = Boolean(headSha) && headSha !== pendingReview.headSha

	return (
		<Card className="gap-3 border-amber-500/30 bg-amber-500/5">
			<div className="flex flex-col gap-1">
				<h2 className="flex items-center gap-2 font-semibold text-base tracking-normal">
					<EyeOff aria-hidden className="size-4 text-amber-400" />
					Your review is pending
				</h2>
				<p className="text-muted-foreground text-sm">
					{commentCount
						? `${commentCount} ${commentCount === 1 ? 'comment is' : 'comments are'} batched and visible only to you. Submitting publishes them together.`
						: 'Nothing is batched yet. Submit to leave a review without comments, or add comments first.'}
				</p>
				{hasMovedHead && (
					<p className="text-amber-400 text-sm">
						The branch moved since you started this review. Submitting records
						it against the changes shown now.
					</p>
				)}
			</div>
			{allowedOutcomes.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2">
					<PullRequestReviewDialog
						allowedOutcomes={allowedOutcomes}
						headSha={headSha}
						number={number}
						pendingCommentCount={commentCount}
						slug={slug}
						triggerLabel="Submit review"
						username={username}
					/>
					<PullRequestDiscardReviewDialog
						commentCount={commentCount}
						number={number}
						slug={slug}
						username={username}
					/>
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					{isOpen
						? 'You can no longer review this pull request, so this draft stays where it is.'
						: 'This pull request is no longer open, so the draft can no longer be submitted or discarded.'}
				</p>
			)}
		</Card>
	)
}
