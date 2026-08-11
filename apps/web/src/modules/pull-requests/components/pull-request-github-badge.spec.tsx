import { render, screen } from '@testing-library/react'
import { PullRequestGitHubBadge } from './pull-request-github-badge'
import { PullRequestReadOnlyBanner } from './pull-request-read-only-banner'

describe('pull request GitHub provenance', () => {
	test('names GitHub as the origin and links the source pull request', () => {
		render(
			<PullRequestGitHubBadge sourceUrl="https://github.com/mnigos/notes/pull/7" />
		)

		expect(screen.getByText('From GitHub')).toBeTruthy()

		const link = screen.getByRole('link', { name: 'View on GitHub' })

		expect(link.getAttribute('href')).toBe(
			'https://github.com/mnigos/notes/pull/7'
		)
		expect(link.getAttribute('target')).toBe('_blank')
		expect(link.getAttribute('rel')).toBe('noreferrer')
	})

	test('still states the origin when no source URL survived the projection', () => {
		render(<PullRequestGitHubBadge />)

		expect(screen.getByText('From GitHub')).toBeTruthy()
		expect(screen.queryByRole('link')).toBeNull()
	})

	test('leaves the banner with only the write boundary to explain', () => {
		render(<PullRequestReadOnlyBanner />)

		expect(
			screen.getByText(
				'GitHub owns this pull request. Comments, reviews, and merges happen there and appear here once they sync.'
			)
		).toBeTruthy()
		// The header carries identity and the link now; the banner must not
		// duplicate either, nor offer a control the boundary forbids.
		expect(screen.queryByRole('link')).toBeNull()
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByRole('heading')).toBeNull()
	})
})
