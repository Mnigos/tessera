import type {
	PullRequestEvent,
	PullRequestReview,
	PullRequestReviewerRequest,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { PullRequestEventRow } from './pull-request-event-row'
import { PullRequestReviewEventCard } from './pull-request-review-event-card'

const createdAt = new Date('2026-08-08T10:00:00.000Z')
const REVIEW_REQUESTED_REGEX = /Review requested from jan by marta/
const REVIEW_REQUEST_REMOVED_REGEX = /Review request for jan removed by marta/

function event(
	type: PullRequestEvent['type'],
	payload?: PullRequestEvent['payload']
): PullRequestEvent {
	return {
		id: crypto.randomUUID() as PullRequestEvent['id'],
		pullRequestId: crypto.randomUUID() as PullRequestEvent['pullRequestId'],
		provider: 'tessera',
		actorUsername: 'marta',
		type,
		payload,
		createdAt,
	}
}

describe('pull request review timeline', () => {
	test.each([
		['approve', 'approved these changes', 'border-emerald-500/30'],
		['request_changes', 'requested changes', 'border-rose-500/30'],
		['comment', 'reviewed these changes', 'border-border'],
	] as const)('styles a %s review and renders its markdown body', (outcome, label, className) => {
		const reviewEvent = event('review_submitted', {
			reviewId: crypto.randomUUID() as PullRequestReview['id'],
			outcome,
			headSha: 'a'.repeat(40),
		})
		const review: PullRequestReview = {
			id:
				reviewEvent.payload && 'reviewId' in reviewEvent.payload
					? reviewEvent.payload.reviewId
					: (crypto.randomUUID() as PullRequestReview['id']),
			reviewer: {
				key: 'tessera:marta',
				provider: 'tessera',
				username: 'marta',
			},
			state: 'submitted',
			outcome,
			body: '**Important review**',
			headSha: 'a'.repeat(40),
			submittedAt: createdAt,
		}
		const { container } = render(
			<PullRequestReviewEventCard event={reviewEvent} review={review} />
		)

		expect(screen.getByText(`marta ${label}`)).toBeTruthy()
		expect(screen.getByText('Important review').tagName).toBe('STRONG')
		expect(container.firstElementChild?.className).toContain(className)
	})

	test('names reviewer targets in request lifecycle rows', () => {
		const { rerender } = render(
			<PullRequestEventRow
				event={event('review_requested', {
					reviewerUserId: crypto.randomUUID() as NonNullable<
						PullRequestReviewerRequest['reviewer']['userId']
					>,
					reviewerUsername: 'jan',
				})}
			/>
		)
		expect(screen.getByText(REVIEW_REQUESTED_REGEX)).toBeTruthy()

		rerender(
			<PullRequestEventRow
				event={event('review_request_removed', {
					reviewerUserId: crypto.randomUUID() as NonNullable<
						PullRequestReviewerRequest['reviewer']['userId']
					>,
					reviewerUsername: 'jan',
				})}
			/>
		)
		expect(screen.getByText(REVIEW_REQUEST_REMOVED_REGEX)).toBeTruthy()
	})

	test('renders payload-less GitHub review requests without crashing', () => {
		render(
			<PullRequestEventRow
				event={{ ...event('review_requested'), provider: 'github' }}
			/>
		)

		expect(
			screen.getByText('Pull request review requested by marta')
		).toBeTruthy()
	})
})
