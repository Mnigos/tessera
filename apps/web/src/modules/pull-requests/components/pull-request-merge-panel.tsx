import type { PullRequest, PullRequestComparison } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { GitMerge } from 'lucide-react'
import {
	getPullRequestErrorMessage,
	isPullRequestStaleComparisonError,
} from '../helpers/get-pull-request-error-message'
import { useMergePullRequestMutation } from '../hooks/use-merge-pull-request.mutation'

interface PullRequestMergePanelProps {
	username: string
	slug: string
	pullRequest: PullRequest
	comparison: PullRequestComparison | undefined
	isComparisonError: boolean
	isComparisonLoading: boolean
	onRefreshComparison: () => void
}

export function PullRequestMergePanel({
	username,
	slug,
	pullRequest,
	comparison,
	isComparisonError,
	isComparisonLoading,
	onRefreshComparison,
}: Readonly<PullRequestMergePanelProps>) {
	const mergeMutation = useMergePullRequestMutation()

	if (pullRequest.state !== 'open') return null

	function handleMerge() {
		if (!comparison || isComparisonLoading || isComparisonError) return

		mergeMutation.mutate(
			{
				username,
				slug,
				number: pullRequest.number,
				expectedBaseSha: comparison.baseSha,
				expectedHeadSha: comparison.headSha,
			},
			{
				onError: error => {
					if (isPullRequestStaleComparisonError(error)) onRefreshComparison()
				},
			}
		)
	}

	return (
		<Card className="gap-4 border-emerald-500/25 bg-emerald-500/5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Merge pull request
				</h2>
				<p className="text-muted-foreground text-sm">
					Create a two-parent merge commit on {pullRequest.targetBranch}.
				</p>
			</div>
			{mergeMutation.isError && (
				<div className="flex flex-col gap-2">
					<p className="text-destructive text-sm">
						{getPullRequestErrorMessage(
							mergeMutation.error,
							'The pull request could not be merged.'
						)}
					</p>
					<Button
						className="w-fit"
						onClick={onRefreshComparison}
						size="sm"
						variant="outline"
					>
						Refresh comparison
					</Button>
				</div>
			)}
			{isComparisonError && (
				<div className="flex flex-col gap-2">
					<p className="text-destructive text-sm">
						The merge comparison could not be refreshed.
					</p>
					<Button
						className="w-fit"
						onClick={onRefreshComparison}
						size="sm"
						variant="outline"
					>
						Retry comparison
					</Button>
				</div>
			)}
			<Button
				className="w-fit"
				disabled={
					!comparison ||
					isComparisonLoading ||
					isComparisonError ||
					mergeMutation.isPending
				}
				onClick={handleMerge}
				size="sm"
			>
				<GitMerge className="size-4" />
				{mergeMutation.isPending ? 'Merging' : 'Merge pull request'}
			</Button>
		</Card>
	)
}
