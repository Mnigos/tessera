import type { CheckState } from '@repo/contracts'

/**
 * A provider result normalized into the native vocabulary, plus whatever GitHub
 * said that has no mapping here. Nothing is discarded — the raw status and
 * conclusion are stored alongside the observation — but a value that had to
 * fail closed is worth reporting rather than flattening silently.
 */
export interface NativeCheckState {
	state: CheckState
	/** The raw value that produced a fallback, when one did. */
	unrecognized?: string
}

/**
 * A check run's own report. The conclusion wins whenever GitHub published one;
 * until then the status says how far along the run is.
 */
export function toNativeCheckState({
	conclusion,
	status,
}: {
	conclusion?: string
	status?: string
}): NativeCheckState {
	if (conclusion) return toCheckConclusionState(conclusion)

	switch (status) {
		case 'queued':
			return { state: 'queued' }
		case 'in_progress':
		case 'pending':
		case 'requested':
		case 'waiting':
			return { state: 'pending' }
		// GitHub called the run finished without saying how it finished. That
		// cannot be read as passing, so it fails closed and reports the status it
		// arrived with.
		case 'completed':
			return { state: 'failure', unrecognized: status }
		default:
			// An unknown status is not evidence the run ended, so it stays
			// non-terminal instead of failing a check that may still pass.
			return status
				? { state: 'pending', unrecognized: status }
				: { state: 'pending' }
	}
}

/**
 * A commit status carries a state and nothing else. `error` normalizes into
 * `failure` here and survives verbatim in `rawStatus`.
 */
export function toNativeCommitStatusState(state: string): NativeCheckState {
	switch (state) {
		case 'pending':
			return { state: 'pending' }
		case 'success':
			return { state: 'success' }
		case 'failure':
		case 'error':
			return { state: 'failure' }
		default:
			return { state: 'failure', unrecognized: state }
	}
}

function toCheckConclusionState(conclusion: string): NativeCheckState {
	switch (conclusion) {
		case 'success':
			return { state: 'success' }
		case 'failure':
		case 'action_required':
		case 'startup_failure':
			return { state: 'failure' }
		case 'neutral':
			return { state: 'neutral' }
		// GitHub spells it the British way; the native vocabulary does not.
		case 'cancelled':
			return { state: 'canceled' }
		case 'skipped':
			return { state: 'skipped' }
		case 'timed_out':
			return { state: 'timed_out' }
		// GitHub's own terminal conclusion for a result it invalidated, which is
		// not the same as a result computed against a head the branch moved past.
		case 'stale':
			return { state: 'stale' }
		default:
			return { state: 'failure', unrecognized: conclusion }
	}
}
