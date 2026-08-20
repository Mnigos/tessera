import type {
	ChecksSummary,
	MergeQueueStatus,
	PullRequest,
} from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { usePullRequestChecksQuery } from '../hooks/use-pull-request-checks.query'
import {
	hasPullRequestChecksSection,
	PullRequestChecksPanel,
} from './pull-request-checks-panel'
import { PullRequestMergePanel } from './pull-request-merge-panel'

interface PullRequestMergeBoxProps {
	username: string
	slug: string
	pullRequest: PullRequest
	checksSummary?: ChecksSummary
	mergeQueue: MergeQueueStatus
	canWrite: boolean
	isGitHubAuthoritative: boolean
}

/** The accent the box carries, taken from the one rollup a reader acts on. */
const CHECKS_EDGE_CLASSES = {
	none: 'border-l-border',
	pending: 'border-l-amber-500/70',
	success: 'border-l-emerald-500/70',
	failure: 'border-l-rose-500/70',
} as const

/**
 * Where a pull request ends: what its checks say, and what merging it would do.
 *
 * The two belong to one decision, so they are one box with one edge colour
 * rather than two panels a reader has to reconcile. It draws nothing at all
 * when neither half has anything to say — a closed pull request nobody ran a
 * check on has no verdict left to give.
 */
export function PullRequestMergeBox({
	username,
	slug,
	pullRequest,
	checksSummary,
	mergeQueue,
	canWrite,
	isGitHubAuthoritative,
}: Readonly<PullRequestMergeBoxProps>) {
	const number = String(pullRequest.number)
	// The same input the checks section reads with, so both share one cache entry.
	const checksQuery = usePullRequestChecksQuery(
		{ username, slug, number, expectedHeadSha: checksSummary?.headSha ?? '' },
		Boolean(checksSummary)
	)

	const hasChecks = hasPullRequestChecksSection(checksSummary, checksQuery)
	const hasMerge = canWrite && pullRequest.state === 'open'

	if (!(hasChecks || hasMerge)) return null

	return (
		<div
			className={cn(
				'flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border border-l-4 bg-card',
				hasChecks && checksSummary
					? CHECKS_EDGE_CLASSES[checksSummary.overall]
					: 'border-l-border'
			)}
		>
			<PullRequestChecksPanel
				checksSummary={checksSummary}
				number={number}
				slug={slug}
				username={username}
			/>
			{hasMerge && (
				<PullRequestMergePanel
					isGitHubAuthoritative={isGitHubAuthoritative}
					mergeQueue={mergeQueue}
					pullRequest={pullRequest}
					slug={slug}
					username={username}
				/>
			)}
		</div>
	)
}
