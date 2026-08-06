import type {
	PullRequestThread,
	PullRequestThreadAnchor,
} from '@repo/contracts'
import { History } from 'lucide-react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
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
	const createThreadMutation = useCreatePullRequestThreadMutation()

	function handleCreateThread(body: string) {
		if (!anchor) return

		createThreadMutation.mutate(
			{ username, slug, number, body, anchor },
			{ onSuccess: onComposerDone }
		)
	}

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
					<div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
						<h3 className="font-medium text-sm">
							Comment on line {anchor.line}
						</h3>
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
							onCancel={onComposerDone}
							onSubmit={handleCreateThread}
							pendingLabel="Posting"
							placeholder="Leave a comment on this line"
							shouldFocusOnMount
							submitLabel="Comment"
						/>
					</div>
				)}
			</div>
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
