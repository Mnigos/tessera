import type {
	PullRequestEvent,
	PullRequestReview,
	SessionUser,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
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
import { PullRequestReviewEventCard } from './pull-request-review-event-card'
import { PullRequestThreadCard } from './pull-request-thread-card'

interface PullRequestTimelineProps {
	username: string
	slug: string
	number: string
	events: PullRequestEvent[]
	reviews?: PullRequestReview[]
	review?: PullRequestReviewContext
	viewerUserId?: SessionUser['id']
}

export function PullRequestTimeline({
	username,
	slug,
	number,
	events,
	reviews,
	review,
	viewerUserId,
}: Readonly<PullRequestTimelineProps>) {
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	const permissions = getPullRequestThreadPermissions({
		viewer: threadsQuery.data?.viewer,
		viewerUserId,
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
			<h2 className="font-semibold text-base tracking-normal">Activity</h2>
			{entries.length === 0 &&
			!threadsQuery.isLoading &&
			!threadsQuery.isError ? (
				<p className="text-muted-foreground text-sm italic">No activity yet.</p>
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
										review={findPullRequestReview(entry.event, reviews)}
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
					number={number}
					review={permissions.review}
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
	// not move it under a comment the viewer is still writing.
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
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
			<h3 className="font-medium text-sm">Add a comment</h3>
			<PullRequestCommentComposer
				errorMessage={
					createThreadMutation.isError
						? getPullRequestErrorMessage(
								createThreadMutation.error,
								'The comment could not be posted.'
							)
						: undefined
				}
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
