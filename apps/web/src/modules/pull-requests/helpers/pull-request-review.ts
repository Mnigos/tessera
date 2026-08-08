import type {
	PullRequestActor,
	PullRequestEffectiveReviewState,
	PullRequestEvent,
	PullRequestReviewerRequest,
	PullRequestReviewId,
	PullRequestReviewOutcome,
} from '@repo/contracts'
import {
	CircleCheck,
	CircleX,
	Clock,
	type LucideIcon,
	MessageSquare,
} from 'lucide-react'

/**
 * What the viewer may do with reviews on the surface being rendered. The
 * capabilities come from the server; the head SHA is whichever comparison the
 * viewer currently sees, so a batched comment can never be attached to a head
 * they have not read.
 */
export interface PullRequestReviewContext {
	canSubmitReview: boolean
	hasPendingReview: boolean
	headSha?: string
}

export interface PullRequestReviewOutcomePresentation {
	label: string
	timelineLabel: string
	icon: LucideIcon
	iconClassName: string
	cardClassName: string
}

const PULL_REQUEST_REVIEW_OUTCOME_PRESENTATIONS: Record<
	PullRequestReviewOutcome,
	PullRequestReviewOutcomePresentation
> = {
	approve: {
		label: 'Approved',
		timelineLabel: 'approved these changes',
		icon: CircleCheck,
		iconClassName: 'text-emerald-400',
		cardClassName: 'border-emerald-500/30 bg-emerald-500/5',
	},
	request_changes: {
		label: 'Changes requested',
		timelineLabel: 'requested changes',
		icon: CircleX,
		iconClassName: 'text-rose-400',
		cardClassName: 'border-rose-500/30 bg-rose-500/5',
	},
	comment: {
		label: 'Commented',
		timelineLabel: 'reviewed these changes',
		icon: MessageSquare,
		iconClassName: 'text-sky-400',
		cardClassName: 'border-border bg-card',
	},
}

const AWAITING_PULL_REQUEST_REVIEW_PRESENTATION: PullRequestReviewOutcomePresentation =
	{
		label: 'Awaiting review',
		timelineLabel: 'was asked to review',
		icon: Clock,
		iconClassName: 'text-muted-foreground',
		cardClassName: 'border-border bg-card',
	}

/**
 * Returns the icon, accent, and wording for a review outcome. Reviewers that
 * were only requested have no outcome yet and fall back to the awaiting style.
 */
export function getPullRequestReviewOutcomePresentation(
	outcome?: PullRequestReviewOutcome
) {
	if (!outcome) return AWAITING_PULL_REQUEST_REVIEW_PRESENTATION

	return PULL_REQUEST_REVIEW_OUTCOME_PRESENTATIONS[outcome]
}

export const PULL_REQUEST_REVIEW_OUTCOME_OPTIONS = [
	{
		value: 'comment',
		label: 'Comment',
		description: 'Share feedback without approving or blocking the merge.',
	},
	{
		value: 'approve',
		label: 'Approve',
		description: 'Submit feedback and approve merging these changes.',
	},
	{
		value: 'request_changes',
		label: 'Request changes',
		description: 'Submit feedback that must be addressed before merging.',
	},
] as const satisfies readonly {
	value: PullRequestReviewOutcome
	label: string
	description: string
}[]

export interface PullRequestReviewerEntry {
	/** Stable across renames and unmapped GitHub reviewers; keys the rows. */
	key: string
	reviewer: PullRequestActor
	isRequested: boolean
	requestedAt?: Date
	outcome?: PullRequestReviewOutcome
	stale: boolean
	submittedAt?: Date
}

/**
 * Merges active reviewer requests with the latest effective review per reviewer
 * into one row per reviewer. A reviewer who was re-requested after reviewing
 * keeps their outcome and is marked as requested again.
 *
 * Rows are grouped by the reviewer's stable key rather than their login: a
 * GitHub reviewer with no Tessera account still has to stay one row, and logins
 * can be renamed under the same identity.
 */
export function getPullRequestReviewerEntries(
	reviewerRequests: readonly PullRequestReviewerRequest[],
	effectiveReviewStates: readonly PullRequestEffectiveReviewState[]
): PullRequestReviewerEntry[] {
	const entries = new Map<string, PullRequestReviewerEntry>()

	for (const state of effectiveReviewStates)
		entries.set(state.reviewer.key, {
			key: state.reviewer.key,
			reviewer: state.reviewer,
			isRequested: false,
			outcome: state.outcome,
			stale: state.stale,
			submittedAt: state.submittedAt,
		})

	for (const request of reviewerRequests) {
		const entry = entries.get(request.reviewer.key)

		entries.set(request.reviewer.key, {
			key: request.reviewer.key,
			reviewer: request.reviewer,
			stale: entry?.stale ?? false,
			outcome: entry?.outcome,
			submittedAt: entry?.submittedAt,
			isRequested: true,
			requestedAt: request.createdAt,
		})
	}

	return [...entries.values()].sort(comparePullRequestReviewerEntries)
}

function comparePullRequestReviewerEntries(
	first: PullRequestReviewerEntry,
	second: PullRequestReviewerEntry
) {
	if (Boolean(first.outcome) !== Boolean(second.outcome))
		return first.outcome ? -1 : 1

	const firstDate = first.submittedAt ?? first.requestedAt
	const secondDate = second.submittedAt ?? second.requestedAt

	return (
		(firstDate?.getTime() ?? 0) - (secondDate?.getTime() ?? 0) ||
		first.reviewer.username.localeCompare(second.reviewer.username)
	)
}

/**
 * Builds the marker that attaches a comment to the viewer's pending review. The
 * head is the one the composer captured when it opened, never the live one, so
 * a batched comment always names the changes it was actually written against.
 * The marker is omitted whenever the viewer cannot review or that head is
 * unknown.
 */
export function getPullRequestReviewMarker(
	review: PullRequestReviewContext | undefined,
	draftHeadSha: string | undefined
) {
	if (!(review?.canSubmitReview && draftHeadSha)) return undefined

	return { expectedHeadSha: draftHeadSha }
}

/**
 * Labels the composer's secondary action: the first batched comment starts a
 * review, later ones join the review already open.
 */
export function getPullRequestReviewComposerLabel(
	review: PullRequestReviewContext
) {
	return review.hasPendingReview ? 'Add to review' : 'Start a review'
}

interface PullRequestReviewerEventPayload {
	reviewerUsername: string
}

/**
 * Reads the reviewer a request event targets. GitHub-synchronized history
 * carries no payload, so the target may legitimately be unknown.
 */
export function getPullRequestReviewerEventPayload(
	event: PullRequestEvent
): PullRequestReviewerEventPayload | undefined {
	const { payload } = event

	if (payload && 'reviewerUsername' in payload) return payload

	return undefined
}

interface PullRequestReviewEventPayload {
	reviewId: PullRequestReviewId
	/** Absent on a synchronized review the provider dismissed before Tessera saw it. */
	outcome?: PullRequestReviewOutcome
	headSha: string
}

/**
 * Reads the review a submission event refers to, tolerating payload-less events
 * projected from other providers.
 */
export function getPullRequestReviewEventPayload(
	event: PullRequestEvent
): PullRequestReviewEventPayload | undefined {
	const { payload } = event

	if (payload && 'reviewId' in payload) return payload

	return undefined
}
