import type {
	PullRequestComparison as PullRequestComparisonData,
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewViewer,
	SessionUser,
} from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { GitCommitHorizontal } from 'lucide-react'
import { ChecksStatusDot } from '@/modules/checks/components/checks-status-dot'
import type {
	PullRequestReviewContext,
	PullRequestReviewSelection,
} from '../helpers/pull-request-review'
import { usePullRequestComparisonQuery } from '../hooks/use-pull-request-comparison.query'
import { PullRequestComparisonFiles } from './pull-request-comparison-files'
import { PullRequestComparisonSkeleton } from './pull-request-comparison-skeleton'
import { PullRequestDiffSelectionProvider } from './pull-request-diff-selection-context'
import { PullRequestReviewChangesAction } from './pull-request-review-changes-action'
import { PullRequestReviewComparisonFiles } from './pull-request-review-comparison-files'
import { PullRequestReviewComparisonSwitch } from './pull-request-review-comparison-switch'
import { PullRequestsMessage } from './pull-requests-message'

type PullRequestDetailTab = 'overview' | 'commits' | 'files'

interface PullRequestComparisonProps {
	username: string
	slug: string
	number: string
	tab: PullRequestDetailTab
	review?: PullRequestReviewContext
	reviewViewer: PullRequestReviewViewer
	viewerPendingReview?: PullRequestPendingReview
	reviews?: readonly PullRequestReview[]
	viewerUserId?: SessionUser['id']
	isGitHubAuthoritative: boolean
	/** Absent on surfaces that carry no review selection in their URL. */
	reviewSelection?: PullRequestReviewSelection
}

export function PullRequestComparison({
	username,
	slug,
	number,
	tab,
	review,
	reviewViewer,
	viewerPendingReview,
	reviews,
	viewerUserId,
	reviewSelection,
	isGitHubAuthoritative,
}: Readonly<PullRequestComparisonProps>) {
	const selectedReviewId = reviewSelection?.reviewId
	const comparisonQuery = usePullRequestComparisonQuery(
		{ username, slug, number },
		tab !== 'overview' && !selectedReviewId
	)

	if (tab === 'overview') return null

	// The full comparison is not fetched at all while a review is selected, so
	// its states describe the selected one instead.
	if (tab === 'files' && reviewSelection && selectedReviewId)
		return (
			<PullRequestDiffSelectionProvider>
				<PullRequestReviewComparisonFiles
					isGitHubAuthoritative={isGitHubAuthoritative}
					number={number}
					onSelectedReviewIdChange={reviewSelection.onReviewIdChange}
					review={review}
					reviewId={selectedReviewId}
					reviews={reviews ?? []}
					reviewViewer={reviewViewer}
					slug={slug}
					username={username}
					viewerPendingReview={viewerPendingReview}
					viewerUserId={viewerUserId}
				/>
			</PullRequestDiffSelectionProvider>
		)

	if (comparisonQuery.isLoading) return <PullRequestComparisonSkeleton />

	if (comparisonQuery.isError)
		return (
			<PullRequestsMessage
				description="The repository comparison could not be loaded."
				title="Comparison unavailable"
			/>
		)

	if (!comparisonQuery.data)
		return (
			<PullRequestsMessage
				description="The comparison returned no data."
				title="Comparison unavailable"
			/>
		)

	if (tab === 'commits')
		return <PullRequestCommits comparison={comparisonQuery.data} />

	return (
		<PullRequestDiffSelectionProvider>
			<PullRequestComparisonFiles
				anchorComparison={comparisonQuery.data}
				comparison={comparisonQuery.data}
				isGitHubAuthoritative={isGitHubAuthoritative}
				number={number}
				review={review}
				slug={slug}
				toolbarAction={
					<PullRequestReviewChangesAction
						headSha={comparisonQuery.data.headSha}
						isGitHubAuthoritative={isGitHubAuthoritative}
						number={number}
						slug={slug}
						username={username}
						viewer={reviewViewer}
						viewerPendingReview={viewerPendingReview}
					/>
				}
				toolbarLead={
					reviewSelection &&
					reviews &&
					reviews.length > 0 && (
						<PullRequestReviewComparisonSwitch
							onSelectedReviewIdChange={reviewSelection.onReviewIdChange}
							reviews={reviews}
							viewerUserId={viewerUserId}
						/>
					)
				}
				username={username}
				viewerUserId={viewerUserId}
			/>
		</PullRequestDiffSelectionProvider>
	)
}

interface PullRequestCommitsProps {
	comparison: PullRequestComparisonData
}

function PullRequestCommits({ comparison }: Readonly<PullRequestCommitsProps>) {
	if (comparison.commits.length === 0)
		return (
			<PullRequestsMessage
				description="The source branch has no commits beyond the merge base."
				title="No commits to show"
			/>
		)

	return (
		<div className="flex flex-col gap-3">
			{comparison.commitsTruncated && (
				<PullRequestsMessage
					description={`Only the first ${comparison.commitLimit} commits are shown.`}
					title="Commit list truncated"
				/>
			)}
			<Card className="gap-0 p-0">
				<ul className="divide-y divide-border">
					{comparison.commits.map(commit => (
						<li className="flex items-start gap-3 px-4 py-3" key={commit.sha}>
							<GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">{commit.summary}</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{commit.author?.name ?? 'Unknown author'}
								</p>
							</div>
							<ChecksStatusDot summary={commit.checksSummary} />
							<code className="rounded bg-muted px-2 py-1 text-xs">
								{commit.shortSha}
							</code>
						</li>
					))}
				</ul>
			</Card>
		</div>
	)
}
