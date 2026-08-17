import { render, screen } from '@testing-library/react'
import { PullRequestDiffStatsBadge } from './pull-request-diff-stats-badge'

describe(PullRequestDiffStatsBadge.name, () => {
	test('exposes additions and deletions as one accessible description', () => {
		render(<PullRequestDiffStatsBadge additions={12} deletions={4} />)

		expect(screen.getByText('+12').getAttribute('aria-hidden')).toBe('true')
		expect(screen.getByText('−4').getAttribute('aria-hidden')).toBe('true')
		expect(screen.getByText('12 additions and 4 deletions')).toBeTruthy()
		expect(screen.getByTitle('12 additions and 4 deletions')).toBeTruthy()
	})
})
