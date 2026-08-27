import type { RepositorySyncHealth } from '@repo/contracts'
import { getRepositorySyncHealthPresentation } from '@/modules/repositories/helpers/repository-sync-health'

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
/**
 * A mirror that synchronized this recently is fresh for every practical
 * purpose; runs churn constantly on an active repository (every CI check event
 * queues one), and announcing each of them would make the banner wallpaper.
 */
const FRESH_ENOUGH_SECONDS = 180

export function PullRequestTimelineSyncNotice({
	syncHealth,
}: Readonly<PullRequestTimelineSyncNoticeProps>) {
	if (!syncHealth || syncHealth.state === 'healthy') return null
	// Routine catch-up on a fresh mirror is not worth interrupting a reader:
	// the banner speaks for a first backfill, a mirror actually behind, and
	// every state worse than pending.
	if (
		syncHealth.state === 'pending' &&
		syncHealth.freshnessLagSeconds !== undefined &&
		syncHealth.freshnessLagSeconds < FRESH_ENOUGH_SECONDS
	)
		return null

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
				GitHub data may not be fully synchronized, so this activity can be
				incomplete.
			</span>
		</output>
	)
}
