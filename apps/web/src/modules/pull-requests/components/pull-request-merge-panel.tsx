import type { MergeQueueStatus, PullRequest } from '@repo/contracts'
import { DEFAULT_MERGE_STRATEGY, type MergeStrategy } from '@repo/domain'
import { Skeleton } from '@repo/ui/components/skeleton'
import { useState } from 'react'
import {
	GITHUB_MERGE_STRATEGY_ORDER,
	MERGE_STRATEGY_ORDER,
	resolveMergeStrategy,
} from '../helpers/merge-strategy'
import { useMergePullRequestMutation } from '../hooks/use-merge-pull-request.mutation'
import { usePullRequestMergeRequirementsQuery } from '../hooks/use-pull-request-merge-requirements.query'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestMergeQueuePanel } from './pull-request-merge-queue-panel'
import { PullRequestMergeStrategySelect } from './pull-request-merge-strategy-select'
import {
	type PullRequestMergeCommand,
	PullRequestMergeVerdict,
} from './pull-request-merge-verdict'

interface PullRequestMergePanelProps {
	username: string
	slug: string
	pullRequest: PullRequest
	mergeQueue: MergeQueueStatus
	isGitHubAuthoritative: boolean
}

/**
 * The merge affordance, built on the server's own verdict.
 *
 * Everything shown here comes from the merge requirements rather than from a
 * diff comparison: the SHAs it merges are the ones the evaluation resolved, and
 * the reasons it lists are the ones the merge itself would refuse for. The
 * answer is still advisory — merging re-evaluates and can refuse anyway — which
 * is why a refusal is rendered from the result rather than treated as an error.
 */
export function PullRequestMergePanel({
	username,
	slug,
	pullRequest,
	mergeQueue,
	isGitHubAuthoritative,
}: Readonly<PullRequestMergePanelProps>) {
	const isOpen = pullRequest.state === 'open'
	const requirementsQuery = usePullRequestMergeRequirementsQuery(
		{ username, slug, number: pullRequest.number },
		isOpen
	)
	const mergeMutation = useMergePullRequestMutation()
	const [selectedStrategy, setSelectedStrategy] = useState<MergeStrategy>(
		DEFAULT_MERGE_STRATEGY
	)
	// A refusal is what the server returned, not how it failed, so the merge
	// attempt's verdict replaces the one the panel was showing — until the query
	// answers again from after the attempt was sent, which is the case where the
	// blockers have since been resolved and holding on to the refusal would show
	// a wall the server no longer puts up.
	const blockedRequirements =
		mergeMutation.data?.status === 'blocked' &&
		mergeMutation.submittedAt > requirementsQuery.dataUpdatedAt
			? mergeMutation.data.requirements
			: undefined
	const requirements = blockedRequirements ?? requirementsQuery.data
	// Derived rather than stored, so a method the branches have made impossible
	// since it was picked gives way on the next render instead of waiting for an
	// effect to notice and correct it.
	const strategies = isGitHubAuthoritative
		? GITHUB_MERGE_STRATEGY_ORDER
		: MERGE_STRATEGY_ORDER
	const strategy = resolveMergeStrategy(
		selectedStrategy,
		requirements?.strategyAvailability,
		strategies
	)

	if (!isOpen) return null

	function handleMerge({ bypassReason, squash }: PullRequestMergeCommand) {
		if (!(requirements?.evaluatedBaseSha && requirements.evaluatedHeadSha))
			return

		mergeMutation.mutate(
			{
				username,
				slug,
				number: pullRequest.number,
				expectedBaseSha: requirements.evaluatedBaseSha,
				expectedHeadSha: requirements.evaluatedHeadSha,
				bypass: bypassReason ? { reason: bypassReason } : undefined,
				...(strategy === 'squash'
					? { strategy: 'squash' as const, ...squash }
					: { strategy }),
			},
			{
				// The refs this panel offered have moved on, so the next attempt would
				// send the same stale pair again unless the verdict is re-read.
				onSuccess: result => {
					if (
						result.status === 'blocked' &&
						result.requirements.reasons.some(
							reason => reason.code === 'stale_refs'
						)
					)
						requirementsQuery.refetch()
				},
			}
		)
	}

	return (
		<div className="flex flex-col gap-3 p-4">
			<PullRequestMergeStrategySelect
				disabled={mergeMutation.isPending}
				onStrategyChange={setSelectedStrategy}
				strategies={strategies}
				strategy={strategy}
				strategyAvailability={requirements?.strategyAvailability}
				targetBranch={pullRequest.targetBranch}
			/>
			{requirementsQuery.isLoading && !requirements ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 max-w-64" />
					<Skeleton className="h-8 max-w-40" />
				</div>
			) : (
				<PullRequestMergeVerdict
					error={requirementsQuery.error}
					hasMerged={mergeMutation.data?.status === 'merged'}
					isError={requirementsQuery.isError}
					isGitHubAuthoritative={isGitHubAuthoritative}
					isPending={mergeMutation.isPending}
					onMerge={handleMerge}
					onRetryRequirements={() => requirementsQuery.refetch()}
					pullRequest={pullRequest}
					requirements={requirements}
					strategy={strategy}
				/>
			)}
			{mergeMutation.isError && (
				<PullRequestErrorMessage
					error={mergeMutation.error}
					fallback="The pull request could not be merged."
				/>
			)}
			{!isGitHubAuthoritative && (
				<PullRequestMergeQueuePanel
					mergeQueue={mergeQueue}
					pullRequest={pullRequest}
					slug={slug}
					strategy={strategy}
					username={username}
				/>
			)}
		</div>
	)
}
