import type {
	PullRequestPendingReview,
	PullRequestReview,
	PullRequestReviewViewer,
} from '@repo/contracts'
import {
	getPullRequestReviewContext,
	getPullRequestReviewLabel,
} from './pull-request-review'

const submittedAt = new Date('2026-08-08T10:00:00.000Z')
const VIEWER: PullRequestReviewViewer = {
	allowedOutcomes: ['comment', 'approve', 'request_changes'],
	canRequestReviewers: true,
	canRemoveReviewerRequests: true,
}
const PENDING_REVIEW: PullRequestPendingReview = {
	id: '00000000-0000-4000-8000-000000000012' as PullRequestPendingReview['id'],
	headSha: 'a'.repeat(40),
	commentCount: 2,
}

function review(
	state: PullRequestReview['state'],
	outcome?: PullRequestReview['outcome']
): PullRequestReview {
	return {
		id: '00000000-0000-4000-8000-000000000011' as PullRequestReview['id'],
		reviewer: { key: 'github:octo', provider: 'github', username: 'octo' },
		state,
		outcome,
		body: '',
		headSha: 'a'.repeat(40),
		submittedAt,
	}
}

describe('pull request review labels', () => {
	test('keeps the verdict a dismissed review was submitted with', () => {
		expect(getPullRequestReviewLabel(review('submitted', 'approve'))).toBe(
			'Approved'
		)
		expect(getPullRequestReviewLabel(review('dismissed', 'approve'))).toBe(
			'Approved (dismissed)'
		)
	})

	// A review the provider dismissed before Tessera ever saw it has no outcome,
	// and saying it awaits a reviewer would claim it was never submitted.
	test('names a dismissed review that never carried an outcome', () => {
		expect(getPullRequestReviewLabel(review('dismissed'))).toBe('Dismissed')
	})
})

describe(getPullRequestReviewContext.name, () => {
	test('returns the review capability and pending state', () => {
		expect(getPullRequestReviewContext(VIEWER, PENDING_REVIEW)).toEqual({
			allowedOutcomes: ['comment', 'approve', 'request_changes'],
			hasPendingReview: true,
		})
	})

	test('reports no pending review when the viewer has batched nothing', () => {
		expect(getPullRequestReviewContext(VIEWER, undefined)).toEqual({
			allowedOutcomes: ['comment', 'approve', 'request_changes'],
			hasPendingReview: false,
		})
	})
})
