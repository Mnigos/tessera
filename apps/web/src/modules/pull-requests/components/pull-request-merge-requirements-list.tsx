import type { MergeBlockingReason } from '@repo/contracts'
import { CircleAlert } from 'lucide-react'
import {
	getMergeBlockingReasonHint,
	getMergeBlockingReasonMessage,
} from '../helpers/merge-blocking-reason'

interface PullRequestMergeRequirementsListProps {
	reasons: MergeBlockingReason[]
}

/**
 * Everything standing between this pull request and its merge, in the order the
 * server reported it — which is fixed, so the list does not reshuffle between
 * two reads of the same state.
 */
export function PullRequestMergeRequirementsList({
	reasons,
}: Readonly<PullRequestMergeRequirementsListProps>) {
	return (
		<ul className="flex flex-col gap-2">
			{reasons.map(reason => (
				<PullRequestMergeRequirement key={reason.code} reason={reason} />
			))}
		</ul>
	)
}

function PullRequestMergeRequirement({
	reason,
}: Readonly<{ reason: MergeBlockingReason }>) {
	const hint = getMergeBlockingReasonHint(reason)

	return (
		<li className="flex items-start gap-2 text-sm">
			<CircleAlert
				aria-hidden
				className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
			/>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span>{getMergeBlockingReasonMessage(reason)}</span>
				{hint && <span className="text-muted-foreground text-xs">{hint}</span>}
				{reason.code === 'queue_paused' && reason.reasons.length > 0 && (
					<ul className="flex list-disc flex-col gap-0.5 pl-4 text-muted-foreground text-xs">
						{reason.reasons.map(pauseReason => (
							<li key={pauseReason.code}>
								{getMergeBlockingReasonMessage(pauseReason)}
							</li>
						))}
					</ul>
				)}
			</span>
		</li>
	)
}
