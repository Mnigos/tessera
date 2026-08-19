import type {
	PullRequestEvent,
	PullRequestReview,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useState } from 'react'
import { useGitHubSyncHealthQuery } from '@/modules/repositories/hooks/use-github-sync-health.query'
import {
	getPullRequestReviewComposerLabel,
	getPullRequestReviewEventPayload,
	getPullRequestReviewMarker,
	type PullRequestReviewContext,
} from '../helpers/pull-request-review'
import { getPullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { getPullRequestTimelineEntries } from '../helpers/pull-request-timeline'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestCommentComposer } from './pull-request-comment-composer'
import { PullRequestEventRow } from './pull-request-event-row'
import { PullRequestGitHubRefresh } from './pull-request-github-refresh'
import { PullRequestReviewEventCard } from './pull-request-review-event-card'
import { PullRequestThreadCard } from './pull-request-thread-card'
import { PullRequestTimelineSyncNotice } from './pull-request-timeline-sync-notice'

interface PullRequestTimelineProps {
	username: string
	slug: string
	number: string
	events: PullRequestEvent[]
	reviews?: PullRequestReview[]
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
	/**
	 * Whether this pull request came from GitHub, which is what makes it a
	 * projection. Provenance rather than authority: after cutover Tessera can be
	 * written to again, but the history it holds is still only what GitHub sent,
	 * and it is now final at whatever completeness it reached.
	 */
	isFromGitHub: boolean
	/**
	 * Whether GitHub still owns the repository. Only a running mirror has a
	 * synchronization to report on, so a cut-over pull request stops asking for
	 * health that would always come back undefined.
	 */
	isGitHubAuthoritative: boolean
	/**
	 * Sync health is derived from operational rows only the owner may read, so
	 * the notice it drives is only ever asked for on their behalf.
	 */
	canReadSyncHealth: boolean
}

export function PullRequestTimeline({
	username,
	slug,
	number,
	events,
	reviews,
	review,
	viewerUserId,
	isFromGitHub,
	isGitHubAuthoritative,
	canReadSyncHealth,
}: Readonly<PullRequestTimelineProps>) {
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })
	// Provenance and authority both have to hold: a native pull request frozen by
	// its repository being mirrored has no GitHub history to be behind on, and a
	// synchronized one that has cut over has no synchronization left to report.
	const syncHealthQuery = useGitHubSyncHealthQuery(
		{ slug, username },
		isFromGitHub && isGitHubAuthoritative && canReadSyncHealth
	)

	const permissions = getPullRequestThreadPermissions({
		viewer: threadsQuery.data?.viewer,
		viewerUserId,
		isGitHubAuthoritative,
		review: review && {
			...review,
			headSha: threadsQuery.data?.comparison.headSha,
		},
	})
	const entries = getPullRequestTimelineEntries(
		events,
		threadsQuery.data?.threads ?? []
	)

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-semibold text-base tracking-normal">Activity</h2>
				<PullRequestGitHubRefresh
					number={number}
					slug={slug}
					username={username}
				/>
			</div>
			<PullRequestTimelineSyncNotice
				syncHealth={syncHealthQuery.data?.syncHealth}
			/>
			{entries.length === 0 &&
			!threadsQuery.isLoading &&
			!threadsQuery.isError ? (
				<p className="text-muted-foreground text-sm italic">
					{/* Emptiness on a projection is never evidence of absence: GitHub may
					    hold activity that has not arrived, and "No activity yet" would
					    assert that it does not. */}
					{isFromGitHub
						? 'No activity has synchronized from GitHub yet.'
						: 'No activity yet.'}
				</p>
			) : (
				<ol className="flex flex-col gap-3">
					{entries.map(entry => (
						<li key={entry.id}>
							{entry.type === 'thread' && (
								<PullRequestThreadCard
									number={number}
									permissions={permissions}
									slug={slug}
									thread={entry.thread}
									username={username}
								/>
							)}
							{entry.type === 'event' &&
								(entry.event.type === 'review_submitted' ? (
									<PullRequestReviewEventCard
										event={entry.event}
										number={number}
										review={findPullRequestReview(entry.event, reviews)}
										slug={slug}
										username={username}
									/>
								) : (
									<PullRequestEventRow event={entry.event} />
								))}
						</li>
					))}
				</ol>
			)}
			{threadsQuery.isLoading && <Skeleton className="h-24" />}
			{threadsQuery.isError && (
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-destructive text-sm" role="alert">
						The comments could not be loaded.
					</p>
					<Button
						onClick={() => threadsQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			)}
			{permissions.canComment && (
				<PullRequestTimelineComposer
					key={permissions.review ? 'with-review' : 'without-review'}
					number={number}
					review={
						permissions.isGitHubAuthoritative ? undefined : permissions.review
					}
					slug={slug}
					username={username}
				/>
			)}
		</section>
	)
}

function findPullRequestReview(
	event: PullRequestEvent,
	reviews?: PullRequestReview[]
) {
	const reviewId = getPullRequestReviewEventPayload(event)?.reviewId

	if (!reviewId) return undefined

	return reviews?.find(review => review.id === reviewId)
}

interface PullRequestTimelineComposerProps {
	username: string
	slug: string
	number: string
	review?: PullRequestReviewContext
}

function PullRequestTimelineComposer({
	username,
	slug,
	number,
	review,
}: Readonly<PullRequestTimelineComposerProps>) {
	const [composerKey, setComposerKey] = useState(0)
	// The head the current draft was opened against. A background refetch must
	// not move it under a comment the viewer is still writing. The parent keys
	// this component by review presence, so the initial data load remounts it
	// with the loaded head instead of freezing an undefined one.
	const [draftHeadSha, setDraftHeadSha] = useState(review?.headSha)
	const createThreadMutation = useCreatePullRequestThreadMutation()

	const reviewMarker = getPullRequestReviewMarker(review, draftHeadSha)

	function startNextDraft() {
		setComposerKey(key => key + 1)
		setDraftHeadSha(review?.headSha)
	}

	function handleCreateThread(body: string) {
		createThreadMutation.mutate(
			{ username, slug, number, body },
			{ onSuccess: startNextDraft }
		)
	}

	function handleCreateReviewThread(body: string) {
		createThreadMutation.mutate(
			{ username, slug, number, body, review: reviewMarker },
			{ onSuccess: startNextDraft }
		)
	}

	return (
		<div className="flex flex-col gap-2">
			<PullRequestCommentComposer
				error={createThreadMutation.error}
				errorFallback="The comment could not be posted."
				heading="Add a comment"
				inputId="pull-request-comment-body"
				isPending={createThreadMutation.isPending}
				key={composerKey}
				label="Comment"
				onSecondarySubmit={reviewMarker ? handleCreateReviewThread : undefined}
				onSubmit={handleCreateThread}
				pendingLabel="Posting"
				placeholder="Leave a comment"
				secondarySubmitLabel={
					review ? getPullRequestReviewComposerLabel(review) : undefined
				}
				submitLabel="Comment"
			/>
		</div>
	)
}
