import type {
	PullRequestThread,
	PullRequestThreadAnchor,
} from '@repo/contracts'
import { History } from 'lucide-react'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import {
	getPullRequestReviewComposerLabel,
	getPullRequestReviewMarker,
} from '../helpers/pull-request-review'
import type { PullRequestThreadPermissions } from '../helpers/pull-request-thread-permissions'
import { useCreatePullRequestThreadMutation } from '../hooks/use-create-pull-request-thread.mutation'
import { PullRequestCommentComposer } from './pull-request-comment-composer'
import { PullRequestThreadCard } from './pull-request-thread-card'

interface PullRequestDiffThreadRowProps {
	username: string
	slug: string
	number: string
	threads: PullRequestThread[]
	permissions: PullRequestThreadPermissions
	anchor?: PullRequestThreadAnchor
	onComposerDone: () => void
}

export function PullRequestDiffThreadRow({
	username,
	slug,
	number,
	threads,
	permissions,
	anchor,
	onComposerDone,
}: Readonly<PullRequestDiffThreadRowProps>) {
	return (
		<div className="border-border border-y bg-muted/20 px-4 py-3 font-sans text-sm">
			<div className="flex max-w-3xl flex-col gap-3 whitespace-normal">
				{threads.map(thread => (
					<PullRequestThreadCard
						key={thread.id}
						number={number}
						permissions={permissions}
						slug={slug}
						thread={thread}
						username={username}
					/>
				))}
				{anchor && (
					<PullRequestDiffThreadComposer
						anchor={anchor}
						number={number}
						onDone={onComposerDone}
						permissions={permissions}
						slug={slug}
						username={username}
					/>
				)}
			</div>
		</div>
	)
}

interface PullRequestDiffThreadComposerProps {
	username: string
	slug: string
	number: string
	anchor: PullRequestThreadAnchor
	permissions: PullRequestThreadPermissions
	onDone: () => void
}

function PullRequestDiffThreadComposer({
	username,
	slug,
	number,
	anchor,
	permissions,
	onDone,
}: Readonly<PullRequestDiffThreadComposerProps>) {
	// The composer mounts when the viewer opens it, so its head is the one they
	// were reading; a background refetch cannot move it under the draft.
	const [draftHeadSha] = useState(permissions.review?.headSha)
	const createThreadMutation = useCreatePullRequestThreadMutation()

	const reviewMarker = getPullRequestReviewMarker(
		permissions.review,
		draftHeadSha
	)
	const reviewLabel = permissions.review
		? getPullRequestReviewComposerLabel(permissions.review)
		: undefined

	function handleCreateThread(body: string) {
		createThreadMutation.mutate(
			{ username, slug, number, body, anchor },
			{ onSuccess: onDone }
		)
	}

	function handleCreateReviewThread(body: string) {
		createThreadMutation.mutate(
			{ username, slug, number, body, anchor, review: reviewMarker },
			{ onSuccess: onDone }
		)
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
			<h3 className="font-medium text-sm">Comment on line {anchor.line}</h3>
			<PullRequestCommentComposer
				errorMessage={
					createThreadMutation.isError
						? getPullRequestErrorMessage(
								createThreadMutation.error,
								'The comment could not be posted.'
							)
						: undefined
				}
				inputId={`pull-request-line-comment-${anchor.side}-${anchor.line}`}
				isPending={createThreadMutation.isPending}
				label={`Comment on line ${anchor.line}`}
				onCancel={onDone}
				onSecondarySubmit={reviewMarker ? handleCreateReviewThread : undefined}
				onSubmit={handleCreateThread}
				pendingLabel="Posting"
				placeholder="Leave a comment on this line"
				secondarySubmitLabel={reviewLabel}
				shouldFocusOnMount
				submitLabel="Comment"
			/>
		</div>
	)
}

interface PullRequestOutdatedThreadsProps {
	username: string
	slug: string
	number: string
	threads: PullRequestThread[]
	permissions: PullRequestThreadPermissions
	title?: string
}

export function PullRequestOutdatedThreads({
	username,
	slug,
	number,
	threads,
	permissions,
	title = 'Outdated comments',
}: Readonly<PullRequestOutdatedThreadsProps>) {
	return (
		<section className="flex flex-col gap-3 border-border border-t bg-muted/20 px-4 py-3">
			<h3 className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
				<History aria-hidden className="size-4" />
				{title} ({threads.length})
			</h3>
			<div className="flex max-w-3xl flex-col gap-3">
				{threads.map(thread => (
					<PullRequestThreadCard
						key={thread.id}
						number={number}
						permissions={permissions}
						shouldShowAnchor
						slug={slug}
						thread={thread}
						username={username}
					/>
				))}
			</div>
		</section>
	)
}
