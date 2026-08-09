import type { PullRequestReview } from '@repo/contracts'
import { getPullRequestReviewLabel } from './pull-request-review'

const submittedAt = new Date('2026-08-08T10:00:00.000Z')

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
