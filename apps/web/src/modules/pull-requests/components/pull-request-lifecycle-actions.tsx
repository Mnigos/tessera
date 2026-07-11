import type { PullRequest } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useClosePullRequestMutation } from '../hooks/use-close-pull-request.mutation'
import { useReopenPullRequestMutation } from '../hooks/use-reopen-pull-request.mutation'

interface PullRequestLifecycleActionsProps {
	username: string
	slug: string
	pullRequest: PullRequest
}

export function PullRequestLifecycleActions({
	username,
	slug,
	pullRequest,
}: Readonly<PullRequestLifecycleActionsProps>) {
	const closeMutation = useClosePullRequestMutation()
	const reopenMutation = useReopenPullRequestMutation()

	if (pullRequest.state === 'merged') return null

	const input = { username, slug, number: pullRequest.number }
	const activeMutation =
		pullRequest.state === 'open' ? closeMutation : reopenMutation

	return (
		<div className="flex flex-col gap-2">
			{pullRequest.state === 'open' ? (
				<Button
					disabled={closeMutation.isPending}
					onClick={() => closeMutation.mutate(input)}
					size="sm"
					variant="secondary"
				>
					{closeMutation.isPending ? 'Closing' : 'Close pull request'}
				</Button>
			) : (
				<Button
					disabled={reopenMutation.isPending}
					onClick={() => reopenMutation.mutate(input)}
					size="sm"
					variant="secondary"
				>
					{reopenMutation.isPending ? 'Reopening' : 'Reopen pull request'}
				</Button>
			)}
			{activeMutation.isError && (
				<p className="text-destructive text-sm">
					{getPullRequestErrorMessage(
						activeMutation.error,
						'The pull request state could not be changed.'
					)}
				</p>
			)}
		</div>
	)
}
