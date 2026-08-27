import {
	GITHUB_WRITE_REJECTED_MESSAGES,
	type MergeBlockingReason,
	type MergeRequirements,
	type PullRequest,
} from '@repo/contracts'
import type { MergeStrategy } from '@repo/domain'
import { Button } from '@repo/ui/components/button'
import {
	CheckCircle2,
	GitMerge,
	ShieldAlert,
	TriangleAlert,
} from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { getMergeStrategyLabel } from '../helpers/merge-strategy'
import { toPullRequestDisplayNumber } from '../helpers/pull-request-display-number'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestMergeBypassDialog } from './pull-request-merge-bypass-dialog'
import { PullRequestMergeRequirementsList } from './pull-request-merge-requirements-list'
import {
	PullRequestSquashDialog,
	type PullRequestSquashMessage,
} from './pull-request-squash-dialog'

/** One merge, as the reader asked for it. */
export interface PullRequestMergeCommand {
	/** Present only when merging past requirements the rule allows waiving. */
	bypassReason?: string
	/** Present only when the chosen method is squash. */
	squash?: PullRequestSquashMessage
}

interface PullRequestMergeVerdictProps {
	error: unknown
	/** True once the merge went through, which is the only reason to close. */
	hasMerged: boolean
	isError: boolean
	/** Whether GitHub, not Tessera, decides and performs this merge. */
	isGitHubAuthoritative: boolean
	isPending: boolean
	onMerge: (command: PullRequestMergeCommand) => void
	onRetryRequirements: () => void
	pullRequest: PullRequest
	requirements?: MergeRequirements
	strategy: MergeStrategy
}

/**
 * What the server says about merging, and the button that acts on it.
 *
 * Squashing goes through a dialog first because it writes a message somebody
 * has to live with, and the same dialog is what carries a bypass reason when
 * one is needed — the two are one decision, not two prompts in a row.
 */
export function PullRequestMergeVerdict({
	error,
	hasMerged,
	isError,
	isGitHubAuthoritative,
	isPending,
	onMerge,
	onRetryRequirements,
	pullRequest,
	requirements,
	strategy,
}: Readonly<PullRequestMergeVerdictProps>) {
	const [isSquashRequested, setIsSquashRequested] = useState(false)
	// Derived rather than closed by hand: a merge that succeeded is done with the
	// dialog, and one that failed needs it back exactly as it was left.
	const isSquashDialogOpen = isSquashRequested && !hasMerged
	if (isError || !requirements)
		return (
			<div className="flex flex-col gap-2">
				<PullRequestErrorMessage
					error={error}
					fallback="The merge requirements could not be checked."
				/>
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

	const gitHubGate = getGitHubMergeGate(
		isGitHubAuthoritative,
		requirements,
		pullRequest
	)

	if (gitHubGate) return gitHubGate

	const mergeLabel = getMergeStrategyLabel(strategy)
	// A squash always confirms its commit message, whether or not it is also
	// waiving policy — the waiver rides along in that same dialog rather than
	// replacing it, so nobody waives a requirement without seeing the commit
	// their waiver produces.
	const squashDialog = (
		bypassReasons: MergeBlockingReason[] | undefined,
		trigger: ReactElement
	) => (
		<PullRequestSquashDialog
			bypassReasons={bypassReasons}
			defaultBody={pullRequest.body}
			defaultTitle={`${pullRequest.title} (#${toPullRequestDisplayNumber(pullRequest)})`}
			isOpen={isSquashDialogOpen}
			isPending={isPending}
			onConfirm={({ bypassReason, ...squash }) =>
				onMerge({ bypassReason, squash })
			}
			onOpenChange={setIsSquashRequested}
			targetBranch={pullRequest.targetBranch}
			trigger={trigger}
		/>
	)

	if (requirements.eligible)
		return (
			<div className="flex flex-col gap-3">
				{!isGitHubAuthoritative && (
					<p className="inline-flex items-center gap-2 text-sm">
						<CheckCircle2
							aria-hidden
							className="size-4 text-emerald-600 dark:text-emerald-500"
						/>
						Everything this branch requires is satisfied.
					</p>
				)}
				{strategy === 'squash' && !isGitHubAuthoritative ? (
					squashDialog(
						undefined,
						<Button className="w-fit" disabled={isPending} size="sm">
							<GitMerge className="size-4" />
							{isPending ? 'Merging' : mergeLabel}
						</Button>
					)
				) : (
					<Button
						className="w-fit"
						disabled={isPending}
						onClick={() => onMerge({})}
						size="sm"
					>
						<GitMerge className="size-4" />
						{isPending ? 'Merging' : mergeLabel}
					</Button>
				)}
				{isGitHubAuthoritative && (
					<p className="text-muted-foreground text-sm">
						GitHub performs the merge and applies its own branch protection.
					</p>
				)}
			</div>
		)

	return (
		<div className="flex flex-col gap-3">
			<p className="font-medium text-sm">
				This pull request cannot be merged yet.
			</p>
			<PullRequestMergeRequirementsList reasons={requirements.reasons} />
			{requirements.canBypass &&
				!isGitHubAuthoritative &&
				(strategy === 'squash' ? (
					squashDialog(
						requirements.reasons,
						<Button className="w-fit" size="sm" variant="outline">
							<ShieldAlert className="size-4" />
							Merge anyway
						</Button>
					)
				) : (
					<PullRequestMergeBypassDialog
						isPending={isPending}
						mergeLabel={mergeLabel}
						onConfirm={bypassReason => onMerge({ bypassReason })}
						reasons={requirements.reasons}
						targetBranch={pullRequest.targetBranch}
					/>
				))}
		</div>
	)
}

/**
 * What GitHub's own state already settles before requirements are worth
 * showing: a mirrored pull request with no counterpart resolves no refs to
 * merge, and a conflicting branch was refused before anyone clicks.
 */
function getGitHubMergeGate(
	isGitHubAuthoritative: boolean,
	requirements: MergeRequirements,
	pullRequest: PullRequest
): ReactElement | undefined {
	if (!isGitHubAuthoritative) return undefined

	// The conflict wins over a missing mapping: GitHub named a concrete reason
	// the person can act on, and the mapping message would bury it.
	if (pullRequest.github?.mergeableState === 'conflicting')
		return (
			<div className="flex flex-col gap-1.5">
				<p className="inline-flex items-center gap-2 font-medium text-sm">
					<TriangleAlert aria-hidden className="size-4 text-amber-500" />
					This branch has conflicts that must be resolved
				</p>
				<p className="text-muted-foreground text-sm">
					Resolve the conflicts on GitHub or from the command line, then merge
					here once the branch is clean.
				</p>
			</div>
		)

	if (
		requirements.eligible &&
		!(requirements.evaluatedBaseSha && requirements.evaluatedHeadSha)
	)
		return (
			<p className="text-sm">
				{GITHUB_WRITE_REJECTED_MESSAGES.missing_mapping}
			</p>
		)

	return undefined
}
