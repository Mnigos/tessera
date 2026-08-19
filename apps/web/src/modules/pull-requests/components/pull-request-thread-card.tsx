import type { PullRequestThread } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { cn } from '@repo/ui/utils'
import { Check, History } from 'lucide-react'
import { useState } from 'react'
import {
	getPullRequestReviewComposerActions,
	getPullRequestReviewMarker,
} from '../helpers/pull-request-review'
import {
	canReplyToPullRequestThread,
	canResolvePullRequestThread,
	type PullRequestThreadPermissions,
} from '../helpers/pull-request-thread-permissions'
import { useReplyPullRequestThreadMutation } from '../hooks/use-reply-pull-request-thread.mutation'
import { useResolvePullRequestThreadMutation } from '../hooks/use-resolve-pull-request-thread.mutation'
import { useUnresolvePullRequestThreadMutation } from '../hooks/use-unresolve-pull-request-thread.mutation'
import { PullRequestActorLabel } from './pull-request-actor-label'
import { PullRequestComment } from './pull-request-comment'
import { PullRequestCommentComposer } from './pull-request-comment-composer'
import { PullRequestErrorMessage } from './pull-request-error-message'

interface PullRequestThreadCardProps {
	username: string
	slug: string
	number: string
	thread: PullRequestThread
	permissions: PullRequestThreadPermissions
	shouldShowAnchor?: boolean
}

export function PullRequestThreadCard({
	username,
	slug,
	number,
	thread,
	permissions,
	shouldShowAnchor,
}: Readonly<PullRequestThreadCardProps>) {
	const [expandedOverride, setExpandedOverride] = useState<boolean>()
	const [isReplying, setIsReplying] = useState(false)
	// The head the open reply was started against, held so a background refetch
	// cannot move it under a draft in progress.
	const [replyHeadSha, setReplyHeadSha] = useState<string>()
	const replyMutation = useReplyPullRequestThreadMutation()
	const resolveMutation = useResolvePullRequestThreadMutation()
	const unresolveMutation = useUnresolvePullRequestThreadMutation()

	const isExpanded = expandedOverride ?? !thread.resolved
	const canReply = canReplyToPullRequestThread(permissions, thread)
	const resolveError = resolveMutation.error ?? unresolveMutation.error
	const input = { username, slug, number, threadId: thread.id }
	const reviewMarker = getPullRequestReviewMarker(
		permissions.review,
		replyHeadSha
	)
	const reviewActions =
		reviewMarker && permissions.review && !permissions.isGitHubAuthoritative
			? getPullRequestReviewComposerActions(permissions.review, 'Reply')
			: undefined
	const isPrimaryReview = reviewActions?.isPrimaryReview ?? false
	const handlePrimaryReply = isPrimaryReview ? handleReplyToReview : handleReply
	const handleSecondaryReply = isPrimaryReview
		? handleReply
		: handleReplyToReview

	function startReply() {
		setReplyHeadSha(permissions.review?.headSha)
		setIsReplying(true)
	}

	function handleToggleResolved() {
		// The card keeps its current shape until the server confirms; clearing the
		// override then hands expansion back to the freshly invalidated thread.
		const mutation = thread.resolved ? unresolveMutation : resolveMutation
		const previousMutation = thread.resolved
			? resolveMutation
			: unresolveMutation

		previousMutation.reset()
		mutation.mutate(input, {
			onSuccess: () => {
				setExpandedOverride(undefined)
				setIsReplying(false)
			},
		})
	}

	function handleReply(body: string) {
		replyMutation.mutate(
			{ ...input, body },
			{ onSuccess: () => setIsReplying(false) }
		)
	}

	function handleReplyToReview(body: string) {
		replyMutation.mutate(
			{ ...input, body, review: reviewMarker },
			{ onSuccess: () => setIsReplying(false) }
		)
	}

	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-md border border-border bg-card p-3',
				thread.resolved && 'bg-muted/30'
			)}
		>
			<PullRequestThreadHeader
				isExpanded={isExpanded}
				onToggleExpanded={() => setExpandedOverride(!isExpanded)}
				shouldShowAnchor={shouldShowAnchor}
				thread={thread}
			/>
			{isExpanded && (
				<>
					{shouldShowAnchor && thread.anchor && (
						<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-muted-foreground text-xs">
							{thread.anchor.lineExcerpt}
						</pre>
					)}
					<ol className="flex flex-col gap-3">
						{thread.comments.map(comment => (
							<PullRequestComment
								comment={comment}
								key={comment.id}
								number={number}
								permissions={permissions}
								slug={slug}
								username={username}
							/>
						))}
					</ol>
					{isReplying && canReply ? (
						<PullRequestCommentComposer
							error={replyMutation.error}
							errorFallback="The reply could not be posted."
							heading="Reply"
							inputId={`pull-request-thread-reply-${thread.id}`}
							isPending={replyMutation.isPending}
							label="Reply to thread"
							onCancel={() => setIsReplying(false)}
							onSecondarySubmit={
								reviewActions ? handleSecondaryReply : undefined
							}
							onSubmit={handlePrimaryReply}
							pendingLabel="Replying"
							placeholder="Write a reply"
							secondarySubmitLabel={reviewActions?.secondaryLabel}
							shouldFocusOnMount
							submitLabel={reviewActions?.primaryLabel ?? 'Reply'}
						/>
					) : (
						<PullRequestThreadActions
							canResolve={canResolvePullRequestThread(permissions, thread)}
							isResolved={Boolean(thread.resolved)}
							isResolvePending={
								resolveMutation.isPending || unresolveMutation.isPending
							}
							onReply={canReply ? startReply : undefined}
							onToggleResolved={handleToggleResolved}
						/>
					)}
				</>
			)}
			{Boolean(resolveError) && (
				<PullRequestErrorMessage
					error={resolveError}
					fallback="The thread state could not be changed."
				/>
			)}
		</div>
	)
}

interface PullRequestThreadHeaderProps {
	thread: PullRequestThread
	isExpanded: boolean
	onToggleExpanded: () => void
	shouldShowAnchor?: boolean
}

function PullRequestThreadHeader({
	thread,
	isExpanded,
	onToggleExpanded,
	shouldShowAnchor,
}: Readonly<PullRequestThreadHeaderProps>) {
	if (!(thread.resolved || thread.outdated || shouldShowAnchor)) return null

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
			{thread.resolved && (
				<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-400 text-xs">
					<Check aria-hidden className="size-3.5" />
					Resolved by
					<PullRequestActorLabel actor={thread.resolved.by} />
				</span>
			)}
			{thread.outdated && (
				<span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-400 text-xs">
					<History aria-hidden className="size-3.5" />
					Outdated
				</span>
			)}
			{shouldShowAnchor && thread.anchor && (
				<span
					className="min-w-0 truncate font-mono text-muted-foreground text-xs"
					title={toAnchorLabel(thread.anchor)}
				>
					{toAnchorLabel(thread.anchor)}
				</span>
			)}
			<Button
				className="ml-auto"
				onClick={onToggleExpanded}
				size="sm"
				variant="ghost"
			>
				{isExpanded
					? 'Hide'
					: `Show ${thread.comments.length} ${thread.comments.length === 1 ? 'comment' : 'comments'}`}
			</Button>
		</div>
	)
}

interface PullRequestThreadActionsProps {
	canResolve: boolean
	isResolved: boolean
	isResolvePending: boolean
	onReply?: () => void
	onToggleResolved: () => void
}

function PullRequestThreadActions({
	canResolve,
	isResolved,
	isResolvePending,
	onReply,
	onToggleResolved,
}: Readonly<PullRequestThreadActionsProps>) {
	if (!(onReply || canResolve)) return null

	return (
		<div className="flex flex-wrap items-center gap-2">
			{onReply && (
				<Button onClick={onReply} size="sm" variant="outline">
					Reply
				</Button>
			)}
			{canResolve && (
				<Button
					disabled={isResolvePending}
					onClick={onToggleResolved}
					size="sm"
					variant="ghost"
				>
					{isResolved ? 'Unresolve' : 'Resolve'}
				</Button>
			)}
		</div>
	)
}

function toAnchorLabel(
	anchor: NonNullable<PullRequestThread['anchor']>
): string {
	const lines =
		anchor.startLine < anchor.endLine
			? `${anchor.startLine}–${anchor.endLine}`
			: `${anchor.endLine}`

	return `${anchor.path}:${lines}`
}
