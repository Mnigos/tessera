import { ORPCError } from '@orpc/client'
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
import { Button } from '@repo/ui/components/button'
import { Skeleton } from '@repo/ui/components/skeleton'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import {
	canWriteRepository,
	isRepositoryOwner,
} from '@/modules/repositories/helpers/repository-viewer-role'
import { toPullRequestDisplayNumber } from '../helpers/pull-request-display-number'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import {
	getPullRequestReviewContext,
	type PullRequestReviewSelection,
} from '../helpers/pull-request-review'
import { usePullRequestQuery } from '../hooks/use-pull-request.query'
import { usePullRequestActivityQuery } from '../hooks/use-pull-request-activity.query'
import { usePullRequestGitHubAutoRefresh } from '../hooks/use-pull-request-github-auto-refresh'
import { PullRequestBranchLabel } from './pull-request-branch-label'
import { PullRequestComparison } from './pull-request-comparison'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'
import { PullRequestTitleEditForm } from './pull-request-edit-form'
import { PullRequestGitHubBadge } from './pull-request-github-badge'
import { PullRequestGitHubWriteThroughNote } from './pull-request-github-write-through-note'
import { PullRequestLifecycleActions } from './pull-request-lifecycle-actions'
import {
	type PullRequestDetailTab,
	PullRequestNavigation,
} from './pull-request-navigation'
import { PullRequestOverview } from './pull-request-overview'
import { PullRequestRetargetDialog } from './pull-request-retarget-dialog'
import { PullRequestStateBadge } from './pull-request-state-badge'
import { PullRequestsMessage } from './pull-requests-message'

interface PullRequestDetailProps {
	username: string
	slug: string
	number: string
	tab: PullRequestDetailTab
	reviewSelection?: PullRequestReviewSelection
}

export function PullRequestDetail({
	username,
	slug,
	number,
	tab,
	reviewSelection,
}: Readonly<PullRequestDetailProps>) {
	const { user } = useAuth()
	const { data, error, isError, isLoading } = usePullRequestQuery({
		username,
		slug,
		number,
	})
	// Polled from here rather than from a tab, so the page keeps itself current
	// whether the reader is on the conversation or in the files.
	const activityQuery = usePullRequestActivityQuery(
		{ username, slug, number },
		Boolean(data)
	)
	usePullRequestGitHubAutoRefresh(
		{ username, slug, number },
		Boolean(activityQuery.data?.mirror)
	)

	if (isLoading)
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-5 max-w-56" />
				<Skeleton className="h-10 max-w-lg" />
				<Skeleton className="h-32" />
			</div>
		)

	if (isError)
		return (
			<PullRequestsMessage
				description={
					error instanceof ORPCError && error.status === 404
						? 'This pull request does not exist or is no longer available.'
						: 'This pull request could not be loaded. Try again.'
				}
				title={
					error instanceof ORPCError && error.status === 404
						? 'Pull request not found'
						: 'Pull request could not be loaded'
				}
			/>
		)

	if (!data)
		return (
			<PullRequestsMessage
				description="The pull request returned no data."
				title="Pull request is unavailable"
			/>
		)

	// Authority decides where a write lands, not whether it is allowed.
	const isGitHubAuthoritative = data.authority === 'github'

	return (
		<PullRequestDetailContent
			canReadSyncHealth={isRepositoryOwner(data.viewerRole)}
			canWrite={canWriteRepository(data.viewerRole)}
			checksSummary={data.checksSummary}
			effectiveReviewStates={data.effectiveReviewStates}
			events={data.events}
			isGitHubAuthoritative={isGitHubAuthoritative}
			mergeQueue={data.mergeQueue}
			pullRequest={data.pullRequest}
			reviewerCandidates={data.reviewerCandidates}
			reviewerRequests={data.reviewerRequests}
			reviewSelection={reviewSelection}
			reviews={data.reviews}
			reviewViewer={data.viewer}
			slug={slug}
			tab={tab}
			username={username}
			viewerPendingReview={data.viewerPendingReview}
			viewerUserId={user?.id}
		/>
	)
}

interface PullRequestDetailContentProps {
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
	isGitHubAuthoritative: boolean
	canReadSyncHealth: boolean
	viewerUserId?: SessionUser['id']
	tab: PullRequestDetailTab
	reviewSelection?: PullRequestReviewSelection
}

function PullRequestDetailContent({
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
	isGitHubAuthoritative,
	canReadSyncHealth,
	viewerUserId,
	tab,
	reviewSelection,
}: Readonly<PullRequestDetailContentProps>) {
	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const sourceUrl = pullRequest.github?.htmlUrl
	const displayNumber = toPullRequestDisplayNumber(pullRequest)
	const { diffStats } = pullRequest
	// Provenance, not authority: a pull request that came from GitHub keeps
	// saying so after the repository cuts over and Tessera can be written to.
	const isFromGitHub = pullRequest.provider === 'github'

	return (
		<section className="flex flex-col gap-3">
			<header className="flex flex-col gap-1.5">
				{isEditingTitle ? (
					<PullRequestTitleEditForm
						onDone={() => setIsEditingTitle(false)}
						pullRequest={pullRequest}
						slug={slug}
						username={username}
					/>
				) : (
					<>
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<div className="flex min-w-0 items-center gap-1">
								<h1 className="min-w-0 font-semibold text-xl tracking-normal">
									{pullRequest.title}{' '}
									<span className="font-normal text-muted-foreground">
										#{displayNumber}
									</span>
								</h1>
								{canWrite && (
									<Button
										aria-label="Edit title"
										className="size-7 shrink-0 text-muted-foreground"
										onClick={() => setIsEditingTitle(true)}
										size="icon"
										variant="ghost"
									>
										<Pencil />
									</Button>
								)}
							</div>
							{canWrite && (
								<PullRequestLifecycleActions
									pullRequest={pullRequest}
									slug={slug}
									username={username}
								/>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
							<PullRequestStateBadge state={pullRequest.state} />
							<span className="inline-flex min-w-0 max-w-full items-center gap-1">
								<PullRequestBranchLabel name={pullRequest.targetBranch} />
								<ArrowLeft aria-hidden className="size-3" />
								<PullRequestBranchLabel name={pullRequest.sourceBranch} />
							</span>
							{canWrite && pullRequest.state === 'open' && (
								<PullRequestRetargetDialog
									pullRequest={pullRequest}
									slug={slug}
									username={username}
								/>
							)}
							<span>
								opened{' '}
								<time
									dateTime={formatPullRequestDateTime(pullRequest.createdAt)}
								>
									{formatPullRequestDate(pullRequest.createdAt)}
								</time>{' '}
								by {pullRequest.authorUsername}
							</span>
							{diffStats && (
								<PullRequestDiffStatsBadge
									additions={diffStats.additions}
									deletions={diffStats.deletions}
								/>
							)}
							{isFromGitHub && <PullRequestGitHubBadge sourceUrl={sourceUrl} />}
							{isGitHubAuthoritative && (
								<PullRequestGitHubWriteThroughNote
									isFromGitHub={isFromGitHub}
								/>
							)}
						</div>
					</>
				)}
				<PullRequestNavigation
					changedFilesCount={diffStats?.changedFiles}
					number={String(pullRequest.number)}
					slug={slug}
					tab={tab}
					username={username}
				/>
			</header>
			{tab === 'overview' ? (
				<PullRequestOverview
					canReadSyncHealth={canReadSyncHealth}
					canWrite={canWrite}
					checksSummary={checksSummary}
					effectiveReviewStates={effectiveReviewStates}
					events={events}
					isFromGitHub={isFromGitHub}
					isGitHubAuthoritative={isGitHubAuthoritative}
					mergeQueue={mergeQueue}
					pullRequest={pullRequest}
					reviewerCandidates={reviewerCandidates}
					reviewerRequests={reviewerRequests}
					reviews={reviews}
					reviewViewer={reviewViewer}
					slug={slug}
					username={username}
					viewerPendingReview={viewerPendingReview}
					viewerUserId={viewerUserId}
				/>
			) : (
				<PullRequestComparison
					isGitHubAuthoritative={isGitHubAuthoritative}
					number={String(pullRequest.number)}
					review={getPullRequestReviewContext(
						reviewViewer,
						viewerPendingReview
					)}
					reviewSelection={reviewSelection}
					reviews={reviews}
					reviewViewer={reviewViewer}
					slug={slug}
					tab={tab}
					username={username}
					viewerPendingReview={viewerPendingReview}
					viewerUserId={viewerUserId}
				/>
			)}
		</section>
	)
}
