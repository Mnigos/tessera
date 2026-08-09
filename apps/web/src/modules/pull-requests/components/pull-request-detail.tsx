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
import { Link } from '@tanstack/react-router'
import { ArrowRight, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { canWriteRepository } from '@/modules/repositories/helpers/repository-viewer-role'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import { usePullRequestQuery } from '../hooks/use-pull-request.query'
import { PullRequestComparison } from './pull-request-comparison'
import { PullRequestEditForm } from './pull-request-edit-form'
import { PullRequestLifecycleActions } from './pull-request-lifecycle-actions'
import {
	type PullRequestDetailTab,
	PullRequestNavigation,
} from './pull-request-navigation'
import { PullRequestOverview } from './pull-request-overview'
import { PullRequestReadOnlyBanner } from './pull-request-read-only-banner'
import { PullRequestSourceLink } from './pull-request-source-link'
import { PullRequestStateBadge } from './pull-request-state-badge'
import { PullRequestsMessage } from './pull-requests-message'

interface PullRequestDetailProps {
	username: string
	slug: string
	number: string
	tab: PullRequestDetailTab
}

export function PullRequestDetail({
	username,
	slug,
	number,
	tab,
}: Readonly<PullRequestDetailProps>) {
	const { user } = useAuth()
	const { data, error, isError, isLoading } = usePullRequestQuery({
		username,
		slug,
		number,
	})

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

	// Authority, not the pull request's provider: a GitHub-origin pull request
	// becomes writable again once the repository cuts over to Tessera.
	const isReadOnly = data.authority === 'github'

	return (
		<PullRequestDetailContent
			canWrite={canWriteRepository(data.viewerRole) && !isReadOnly}
			checksSummary={data.checksSummary}
			effectiveReviewStates={data.effectiveReviewStates}
			events={data.events}
			isReadOnly={isReadOnly}
			mergeQueue={data.mergeQueue}
			pullRequest={data.pullRequest}
			reviewerCandidates={data.reviewerCandidates}
			reviewerRequests={data.reviewerRequests}
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
	isReadOnly: boolean
	viewerUserId?: SessionUser['id']
	tab: PullRequestDetailTab
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
	isReadOnly,
	viewerUserId,
	tab,
}: Readonly<PullRequestDetailContentProps>) {
	const [isEditing, setIsEditing] = useState(false)
	const sourceUrl = pullRequest.github?.htmlUrl

	return (
		<section className="flex flex-col gap-6">
			<header className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm">
					<Link
						className="hover:underline"
						params={{ username, slug }}
						to="/$username/$slug/pulls"
					>
						Pull requests
					</Link>{' '}
					/ #{pullRequest.number}
				</p>
				{isEditing ? (
					<PullRequestEditForm
						onDone={() => setIsEditing(false)}
						pullRequest={pullRequest}
						slug={slug}
						username={username}
					/>
				) : (
					<>
						<h1 className="font-semibold text-3xl tracking-normal">
							{pullRequest.title}{' '}
							<span className="font-normal text-muted-foreground">
								#{pullRequest.number}
							</span>
						</h1>
						<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
							<PullRequestStateBadge state={pullRequest.state} />
							<span className="inline-flex min-w-0 max-w-full items-center gap-1">
								<span
									className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs sm:max-w-64"
									title={pullRequest.sourceBranch}
								>
									{pullRequest.sourceBranch}
								</span>
								<ArrowRight aria-hidden className="size-3" />
								<span
									className="max-w-48 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs sm:max-w-64"
									title={pullRequest.targetBranch}
								>
									{pullRequest.targetBranch}
								</span>
							</span>
							<span>
								opened{' '}
								<time
									dateTime={formatPullRequestDateTime(pullRequest.createdAt)}
								>
									{formatPullRequestDate(pullRequest.createdAt)}
								</time>{' '}
								by {pullRequest.authorUsername}
							</span>
							{sourceUrl && <PullRequestSourceLink href={sourceUrl} />}
						</div>
						{canWrite && (
							<div className="flex flex-wrap items-start gap-2">
								<Button
									onClick={() => setIsEditing(true)}
									size="sm"
									variant="outline"
								>
									<Pencil className="size-4" />
									Edit
								</Button>
								<PullRequestLifecycleActions
									pullRequest={pullRequest}
									slug={slug}
									username={username}
								/>
							</div>
						)}
					</>
				)}
				{isReadOnly && <PullRequestReadOnlyBanner sourceUrl={sourceUrl} />}
			</header>
			<PullRequestNavigation
				number={String(pullRequest.number)}
				slug={slug}
				tab={tab}
				username={username}
			/>
			{tab === 'overview' ? (
				<PullRequestOverview
					canWrite={canWrite}
					checksSummary={checksSummary}
					effectiveReviewStates={effectiveReviewStates}
					events={events}
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
					number={String(pullRequest.number)}
					review={{
						canSubmitReview: reviewViewer.canSubmitReview,
						hasPendingReview: Boolean(viewerPendingReview),
					}}
					slug={slug}
					tab={tab}
					username={username}
					viewerUserId={viewerUserId}
				/>
			)}
		</section>
	)
}
