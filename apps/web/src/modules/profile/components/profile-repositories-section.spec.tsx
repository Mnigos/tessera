import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { ProfileRepositoriesSection } from './profile-repositories-section'

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		...props
	}: AnchorHTMLAttributes<HTMLAnchorElement> & {
		children: ReactNode
		to: string
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))

const IMPORT_FROM_GITHUB_REGEX = /import from github/i

describe('ProfileRepositoriesSection', () => {
	test('points the owner toward GitHub import in the empty state', () => {
		render(
			<ProfileRepositoriesSection
				isError={false}
				isLoading={false}
				isOwner
				repositories={[]}
				username="mnigos"
			/>
		)

		const importLink = screen.getByRole('button', {
			name: IMPORT_FROM_GITHUB_REGEX,
		})

		expect(importLink.getAttribute('href')).toBe('/import/github')
	})

	test('hides the GitHub import CTA for non-owners', () => {
		render(
			<ProfileRepositoriesSection
				isError={false}
				isLoading={false}
				isOwner={false}
				repositories={[]}
				username="mnigos"
			/>
		)

		expect(screen.getByText('No repositories yet.')).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: IMPORT_FROM_GITHUB_REGEX })
		).toBeNull()
	})
})
