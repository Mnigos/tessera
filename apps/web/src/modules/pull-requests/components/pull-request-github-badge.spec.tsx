import { render, screen } from '@testing-library/react'
import { PullRequestGitHubBadge } from './pull-request-github-badge'
import { PullRequestGitHubWriteThroughNote } from './pull-request-github-write-through-note'

const GITHUB_COUNTERPART_REGEX = /GitHub owns this pull request/

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

	test('leaves the note with only the attribution to explain', () => {
		render(<PullRequestGitHubWriteThroughNote isFromGitHub />)

		expect(
			screen.getByText(
				'GitHub owns this pull request. Anything you post here is sent to GitHub as you.'
			)
		).toBeTruthy()
		// The header already carries identity and the link.
		expect(screen.queryByRole('link')).toBeNull()
		expect(screen.queryByRole('button')).toBeNull()
		expect(screen.queryByRole('heading')).toBeNull()
	})

	// A pull request opened before the mirror has no GitHub copy to name.
	test('names no GitHub counterpart for a native pull request', () => {
		render(<PullRequestGitHubWriteThroughNote isFromGitHub={false} />)

		expect(
			screen.getByText(
				'GitHub is the source of truth for this repository; changes you make here are sent to GitHub as you.'
			)
		).toBeTruthy()
		expect(screen.queryByText(GITHUB_COUNTERPART_REGEX)).toBeNull()
		expect(screen.queryByRole('link')).toBeNull()
	})
})
