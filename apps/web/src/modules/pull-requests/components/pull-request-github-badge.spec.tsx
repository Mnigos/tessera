import { render, screen } from '@testing-library/react'
import { PullRequestGitHubBadge } from './pull-request-github-badge'
import { PullRequestReadOnlyBanner } from './pull-request-read-only-banner'

const GITHUB_COUNTERPART_REGEX = /happen there/

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
		render(<PullRequestReadOnlyBanner isFromGitHub />)

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

	// A repository can be mirrored after native pull requests already exist in
	// it. Those are frozen too, but there is no GitHub copy to send anybody to.
	test('sends a frozen native pull request to no GitHub counterpart', () => {
		render(<PullRequestReadOnlyBanner isFromGitHub={false} />)

		expect(
			screen.getByText(
				'GitHub is the source of truth for this repository, so Tessera accepts no changes to this pull request.'
			)
		).toBeTruthy()
		expect(screen.queryByText(GITHUB_COUNTERPART_REGEX)).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})
})
