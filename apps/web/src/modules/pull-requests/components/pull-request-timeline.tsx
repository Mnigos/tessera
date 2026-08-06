import type { PullRequestEvent, SessionUser } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { getPullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { getPullRequestTimelineEntries } from '../helpers/pull-request-timeline'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestCommentComposer } from './pull-request-comment-composer'
import { PullRequestEventRow } from './pull-request-event-row'
import { PullRequestThreadCard } from './pull-request-thread-card'

interface PullRequestTimelineProps {
	username: string
	slug: string
	number: string
	events: PullRequestEvent[]
	viewerUserId?: SessionUser['id']
}

export function PullRequestTimeline({
	username,
	slug,
	number,
	events,
	viewerUserId,
}: Readonly<PullRequestTimelineProps>) {
	const threadsQuery = usePullRequestThreadsQuery({ username, slug, number })

	const permissions = getPullRequestThreadPermissions({
		viewer: threadsQuery.data?.viewer,
		viewerUserId,
	})
	const entries = getPullRequestTimelineEntries(
		events,
		threadsQuery.data?.threads ?? []
	)

	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-semibold text-base tracking-normal">Activity</h2>
			{entries.length === 0 && !threadsQuery.isLoading ? (
				<p className="text-muted-foreground text-sm italic">No activity yet.</p>
			) : (
				<ol className="flex flex-col gap-3">
					{entries.map(entry => (
						<li key={entry.id}>
							{entry.type === 'event' ? (
								<PullRequestEventRow event={entry.event} />
							) : (
								<PullRequestThreadCard
									number={number}
									permissions={permissions}
									slug={slug}
									thread={entry.thread}
									username={username}
								/>
							)}
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
					slug={slug}
					username={username}
				/>
			)}
		</section>
	)
}

interface PullRequestTimelineComposerProps {
	username: string
	slug: string
	number: string
}

function PullRequestTimelineComposer({
	username,
	slug,
	number,
}: Readonly<PullRequestTimelineComposerProps>) {
	const [composerKey, setComposerKey] = useState(0)
	const createThreadMutation = useCreatePullRequestThreadMutation()

	function handleCreateThread(body: string) {
		createThreadMutation.mutate(
			{ username, slug, number, body },
			{ onSuccess: () => setComposerKey(key => key + 1) }
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
				onSubmit={handleCreateThread}
				pendingLabel="Posting"
				placeholder="Leave a comment"
				submitLabel="Comment"
			/>
		</div>
	)
}
