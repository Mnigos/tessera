import type { PullRequestThread } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { cn } from '@repo/ui/utils'
import { Check, History } from 'lucide-react'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import {
	canResolvePullRequestThread,
	type PullRequestThreadPermissions,
} from '../helpers/pull-request-thread-permissions'
import { useReplyPullRequestThreadMutation } from '../hooks/use-reply-pull-request-thread.mutation'
import { useResolvePullRequestThreadMutation } from '../hooks/use-resolve-pull-request-thread.mutation'
import { useUnresolvePullRequestThreadMutation } from '../hooks/use-unresolve-pull-request-thread.mutation'
import { PullRequestComment } from './pull-request-comment'
import { PullRequestCommentComposer } from './pull-request-comment-composer'

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
	const replyMutation = useReplyPullRequestThreadMutation()
	const resolveMutation = useResolvePullRequestThreadMutation()
	const unresolveMutation = useUnresolvePullRequestThreadMutation()

	const isExpanded = expandedOverride ?? !thread.resolved
	const resolveError = resolveMutation.error ?? unresolveMutation.error
	const input = { username, slug, number, threadId: thread.id }

	function handleToggleResolved() {
		// The card keeps its current shape until the server confirms; clearing the
		// override then hands expansion back to the freshly invalidated thread.
		const mutation = thread.resolved ? unresolveMutation : resolveMutation

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

	return (
		<div
			className={cn(
				'flex flex-col gap-3 rounded-lg border border-border bg-card p-4',
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
					<ol className="flex flex-col gap-4">
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
					{isReplying ? (
						<PullRequestCommentComposer
							errorMessage={
								replyMutation.isError
									? getPullRequestErrorMessage(
											replyMutation.error,
											'The reply could not be posted.'
										)
									: undefined
							}
							inputId={`pull-request-thread-reply-${thread.id}`}
							isPending={replyMutation.isPending}
							label="Reply to thread"
							onCancel={() => setIsReplying(false)}
							onSubmit={handleReply}
							pendingLabel="Replying"
							placeholder="Write a reply"
							shouldFocusOnMount
							submitLabel="Reply"
						/>
					) : (
						<PullRequestThreadActions
							canResolve={canResolvePullRequestThread(permissions, thread)}
							isResolved={Boolean(thread.resolved)}
							isResolvePending={
								resolveMutation.isPending || unresolveMutation.isPending
							}
							onReply={
								permissions.canComment ? () => setIsReplying(true) : undefined
							}
							onToggleResolved={handleToggleResolved}
						/>
					)}
				</>
			)}
			{resolveError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						resolveError,
						'The thread state could not be changed.'
					)}
				</p>
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
					Resolved by {thread.resolved.byUsername}
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
					title={`${thread.anchor.path}:${thread.anchor.line}`}
				>
					{thread.anchor.path}:{thread.anchor.line}
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
