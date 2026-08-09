import type {
	MergeQueueStatus,
	MergeRequirements,
	PullRequest,
} from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Skeleton } from '@repo/ui/components/skeleton'
import { CheckCircle2, GitMerge } from 'lucide-react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useMergePullRequestMutation } from '../hooks/use-merge-pull-request.mutation'
import { usePullRequestMergeRequirementsQuery } from '../hooks/use-pull-request-merge-requirements.query'
import { PullRequestMergeBypassDialog } from './pull-request-merge-bypass-dialog'
import { PullRequestMergeQueuePanel } from './pull-request-merge-queue-panel'
import { PullRequestMergeRequirementsList } from './pull-request-merge-requirements-list'

interface PullRequestMergePanelProps {
	username: string
	slug: string
	pullRequest: PullRequest
	mergeQueue: MergeQueueStatus
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
}: Readonly<PullRequestMergePanelProps>) {
	const isOpen = pullRequest.state === 'open'
	const requirementsQuery = usePullRequestMergeRequirementsQuery(
		{ username, slug, number: pullRequest.number },
		isOpen
	)
	const mergeMutation = useMergePullRequestMutation()
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

	if (!isOpen) return null

	function handleMerge(bypassReason?: string) {
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
		<Card className="gap-4 border-emerald-500/25 bg-emerald-500/5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Merge pull request
				</h2>
				<p className="text-muted-foreground text-sm">
					Create a two-parent merge commit on {pullRequest.targetBranch}.
				</p>
			</div>
			{requirementsQuery.isLoading && !requirements ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-4 max-w-64" />
					<Skeleton className="h-8 max-w-40" />
				</div>
			) : (
				<PullRequestMergeVerdict
					error={requirementsQuery.error}
					isError={requirementsQuery.isError}
					isPending={mergeMutation.isPending}
					onMerge={handleMerge}
					onRetryRequirements={() => requirementsQuery.refetch()}
					requirements={requirements}
					targetBranch={pullRequest.targetBranch}
				/>
			)}
			{mergeMutation.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						mergeMutation.error,
						'The pull request could not be merged.'
					)}
				</p>
			)}
			<PullRequestMergeQueuePanel
				mergeQueue={mergeQueue}
				number={pullRequest.number}
				slug={slug}
				username={username}
			/>
		</Card>
	)
}

interface PullRequestMergeVerdictProps {
	error: unknown
	isError: boolean
	isPending: boolean
	onMerge: (bypassReason?: string) => void
	onRetryRequirements: () => void
	requirements?: MergeRequirements
	targetBranch: string
}

function PullRequestMergeVerdict({
	error,
	isError,
	isPending,
	onMerge,
	onRetryRequirements,
	requirements,
	targetBranch,
}: Readonly<PullRequestMergeVerdictProps>) {
	if (isError || !requirements)
		return (
			<div className="flex flex-col gap-2">
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						error,
						'The merge requirements could not be checked.'
					)}
				</p>
				<Button
					className="w-fit"
					onClick={onRetryRequirements}
					size="sm"
					variant="outline"
				>
					Check again
				</Button>
			</div>
		)

	if (requirements.eligible)
		return (
			<div className="flex flex-col gap-3">
				<p className="inline-flex items-center gap-2 text-sm">
					<CheckCircle2
						aria-hidden
						className="size-4 text-emerald-600 dark:text-emerald-500"
					/>
					Everything this branch requires is satisfied.
				</p>
				<Button
					className="w-fit"
					disabled={isPending}
					onClick={() => onMerge()}
					size="sm"
				>
					<GitMerge className="size-4" />
					{isPending ? 'Merging' : 'Merge pull request'}
				</Button>
			</div>
		)

	return (
		<div className="flex flex-col gap-3">
			<p className="font-medium text-sm">
				This pull request cannot be merged yet.
			</p>
			<PullRequestMergeRequirementsList reasons={requirements.reasons} />
			{requirements.canBypass && (
				<PullRequestMergeBypassDialog
					isPending={isPending}
					onConfirm={reason => onMerge(reason)}
					reasons={requirements.reasons}
					targetBranch={targetBranch}
				/>
			)}
		</div>
	)
}
