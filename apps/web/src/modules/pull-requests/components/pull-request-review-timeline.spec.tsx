import type {
	PullRequestEvent,
	PullRequestReview,
	PullRequestReviewerRequest,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { PullRequestEventRow } from './pull-request-event-row'
import { PullRequestReviewEventCard } from './pull-request-review-event-card'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		params,
		search,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		params: Record<string, string>
		search?: { reviewId?: string }
		to: string
	}) => (
		<a data-review-id={search?.reviewId} href={to} {...props}>
			{children}
		</a>
	),
}))

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
			<PullRequestReviewEventCard
				event={reviewEvent}
				number="1"
				review={review}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText(`marta ${label}`)).toBeTruthy()
		expect(screen.getByText('Important review').tagName).toBe('STRONG')
		expect(container.firstElementChild?.className).toContain(className)
		// The card is the entry point into the files view for exactly this review.
		expect(
			screen
				.getByRole('link', { name: 'View changes since this review' })
				.getAttribute('data-review-id')
		).toBe(review.id)
	})

	test('renders a dismissed review whose original outcome GitHub replaced', () => {
		const reviewId = crypto.randomUUID() as PullRequestReview['id']
		const reviewEvent = event('review_submitted', {
			reviewId,
			headSha: 'a'.repeat(40),
		})
		const review: PullRequestReview = {
			id: reviewId,
			reviewer: {
				key: 'github:octo',
				provider: 'github',
				username: 'octo',
			},
			state: 'dismissed',
			body: 'Needs a rename',
			headSha: 'a'.repeat(40),
			submittedAt: createdAt,
			dismissedAt: createdAt,
		}

		render(
			<PullRequestReviewEventCard
				event={reviewEvent}
				number="1"
				review={review}
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText('marta left a review')).toBeTruthy()
		expect(screen.getByText('Dismissed')).toBeTruthy()
	})

	test('names reviewer targets in request lifecycle rows', () => {
		const { container, rerender } = render(
			<PullRequestEventRow
				event={event('review_requested', {
					reviewerUserId: crypto.randomUUID() as NonNullable<
						PullRequestReviewerRequest['reviewer']['userId']
					>,
					reviewerUsername: 'jan',
				})}
			/>
		)
		expect(container.textContent).toMatch(REVIEW_REQUESTED_REGEX)

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
		expect(container.textContent).toMatch(REVIEW_REQUEST_REMOVED_REGEX)
	})

	test('renders payload-less GitHub review requests without crashing', () => {
		const { container } = render(
			<PullRequestEventRow
				event={{ ...event('review_requested'), provider: 'github' }}
			/>
		)

		expect(container.textContent).toContain(
			'Pull request review requested by marta'
		)
	})
})
