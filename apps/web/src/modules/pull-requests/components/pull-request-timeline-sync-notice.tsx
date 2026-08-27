import type { RepositorySyncHealth } from '@repo/contracts'
import {
	formatSyncProgress,
	getRepositorySyncHealthPresentation,
} from '@/modules/repositories/helpers/repository-sync-health'

interface PullRequestTimelineSyncNoticeProps {
	syncHealth?: RepositorySyncHealth
}

/**
 * Says the activity below may be behind GitHub, when Tessera knows that it is.
 *
 * A healthy mirror says nothing at all — a permanent banner on every
 * synchronized pull request would train people to stop reading it, and the
 * whole value of this notice is that its presence means something.
 */
export function PullRequestTimelineSyncNotice({
	syncHealth,
}: Readonly<PullRequestTimelineSyncNoticeProps>) {
	if (!syncHealth || syncHealth.state === 'healthy') return null

	const presentation = getRepositorySyncHealthPresentation(syncHealth)

	// `<output>` rather than a `role="status"` paragraph: the two announce
	// identically — `<output>` carries that role implicitly — and the house lint
	// rejects the explicit role in favour of the element. The notice is a live
	// region either way, because it arrives when the health read resolves and
	// its whole job is to reach the reader before they trust the list below.
	return (
		<output className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-muted-foreground text-sm">
			<presentation.icon
				aria-hidden
				className="mt-0.5 size-4 shrink-0 text-amber-400"
			/>
			<span>
				<span className="font-medium text-foreground">
					{presentation.label}.
				</span>{' '}
				{syncHealth.progress
					? `${formatSyncProgress(syncHealth.progress)}… This page updates as it lands.`
					: 'GitHub data may not be fully synchronized, so this activity can be incomplete.'}
			</span>
		</output>
	)
}
